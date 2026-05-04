export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { auth } from "@/lib/auth";
import { sanitizePhotosArray } from "@/lib/inventory-serialization";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

const SUPPORTED_ACTIONS = ["ml:webhook"];
const PIECE_KEYS = ["pieza", "descripcion", "descripcion_local", "descripcion_ml", "title", "nombre"];
const BRAND_KEYS = ["marca", "brand"];
const VEHICLE_KEYS = ["coche", "vehiculo", "modelo"];
const YEAR_FROM_KEYS = ["ano_desde", "anoDesde", "anio_desde", "anioDesde"];
const YEAR_TO_KEYS = ["ano_hasta", "anoHasta", "anio_hasta", "anioHasta"];
const YEAR_KEYS = ["ano", "anio", "year"];
const LOCATION_KEYS = ["ubicacion", "location", "locacion"];
const DEFAULT_PAGE_SIZE = 10;
const NON_SEARCH_BATCH_SIZE = 120;

const extractMlItemId = (value: unknown) => {
  if (typeof value !== "string") return null;
  const match = value.toUpperCase().match(/MLM\d+/);
  return match ? match[0] : null;
};

const toExtraData = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, any>;
};

const trimOrNull = (value: unknown) => {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized.length ? normalized : null;
};

const readExtraValue = (extraData: Record<string, any>, keys: string[]) => {
  for (const key of keys) {
    const value = trimOrNull(extraData[key]);
    if (value) return value;
  }
  return null;
};

const buildYearLabel = (extraData: Record<string, any>) => {
  const yearFrom = readExtraValue(extraData, YEAR_FROM_KEYS);
  const yearTo = readExtraValue(extraData, YEAR_TO_KEYS);
  if (yearFrom || yearTo) {
    if (yearFrom && yearTo && yearFrom !== yearTo) {
      return `${yearFrom}-${yearTo}`;
    }
    return yearFrom ?? yearTo;
  }
  return readExtraValue(extraData, YEAR_KEYS);
};

function buildMessage(params: {
  status: string | null;
  success: boolean;
  error: string | null;
  piece: string | null;
}) {
  const { status, success, error, piece } = params;
  const pieceLabel = piece ? `la pieza ${piece}` : "la pieza";
  if (error) {
    return `No se pudo sincronizar ${pieceLabel}: ${error}`;
  }
  if (!success) {
    return `${pieceLabel} no pudo actualizarse en la base interna`;
  }
  if (!status) {
    return `${pieceLabel} se sincronizo`;
  }
  const verb =
    status === "active"
      ? "se activo"
      : status === "paused"
        ? "se pauso"
        : status === "inactive"
          ? "se inactivo"
          : "cambio de estado";
  return `${pieceLabel} ${verb}`;
}

const parsePagination = (searchParams: URLSearchParams) => {
  const legacyLimit = Number.parseInt(searchParams.get("limit") ?? "", 10);
  const pageParam = Number.parseInt(searchParams.get("page") ?? "1", 10);
  const pageSizeParamRaw = searchParams.get("pageSize");
  const pageSizeParam = pageSizeParamRaw ? Number.parseInt(pageSizeParamRaw, 10) : NaN;

  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;
  const inferredPageSize = Number.isFinite(pageSizeParam) && pageSizeParam > 0
    ? pageSizeParam
    : Number.isFinite(legacyLimit) && legacyLimit > 0
      ? legacyLimit
      : DEFAULT_PAGE_SIZE;
  const pageSize = Math.min(100, Math.max(1, inferredPageSize));

  return { page, pageSize };
};

const buildLogActionKey = (log: { itemId: string | null; metadata: unknown }) => {
  const metadata = toExtraData(log.metadata);
  const metadataItemId = trimOrNull(metadata.itemId);
  const payloadResource = trimOrNull(metadata.payload?.resource);
  const normalizedMlItemId =
    extractMlItemId(metadataItemId) ?? extractMlItemId(payloadResource) ?? extractMlItemId(log.itemId);
  const normalizedItemId = (
    normalizedMlItemId ?? metadataItemId ?? payloadResource ?? trimOrNull(log.itemId) ?? "sin-item"
  ).toUpperCase();
  const status = (trimOrNull(metadata.mappedStatus) ?? trimOrNull(metadata.status) ?? "sin-status").toLowerCase();
  const updated = typeof metadata.updated === "number" ? metadata.updated : null;
  const error = trimOrNull(metadata.error);
  const success = error ? false : updated === null ? true : updated > 0;
  return `${normalizedItemId}||${status}||${success ? "1" : "0"}`;
};

const dedupeLogsByAction = <T extends { itemId: string | null; metadata: unknown }>(logs: T[]) => {
  const seen = new Set<string>();
  const unique: T[] = [];
  logs.forEach((log) => {
    const key = buildLogActionKey(log);
    if (seen.has(key)) return;
    seen.add(key);
    unique.push(log);
  });
  return unique;
};

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const { page, pageSize } = parsePagination(searchParams);
  const searchTermRaw = (searchParams.get("search") ?? "").trim();
  const searchTerm = searchTermRaw.toLowerCase();
  const hasSearch = searchTerm.length > 0;
  const skip = (page - 1) * pageSize;

  const auditWhere = {
    where: {
      userId: session.user.id,
      action: { in: SUPPORTED_ACTIONS }
    }
  };

  let hasMoreFromDb = false;
  let nonSearchTotalEstimate = 0;
  let logsForPage: Awaited<ReturnType<typeof prisma.auditLog.findMany>> = [];

  if (hasSearch) {
    const allLogs = await prisma.auditLog.findMany({
      ...auditWhere,
      orderBy: { createdAt: "desc" }
    });
    logsForPage = dedupeLogsByAction(allLogs);
  } else {
    const neededUnique = skip + pageSize + 1;
    const uniqueLogs: Awaited<ReturnType<typeof prisma.auditLog.findMany>> = [];
    const seenActions = new Set<string>();
    let offset = 0;

    while (uniqueLogs.length < neededUnique) {
      const batch = await prisma.auditLog.findMany({
        ...auditWhere,
        orderBy: { createdAt: "desc" },
        skip: offset,
        take: NON_SEARCH_BATCH_SIZE
      });

      if (!batch.length) {
        break;
      }

      offset += batch.length;
      batch.forEach((log) => {
        const actionKey = buildLogActionKey(log);
        if (seenActions.has(actionKey)) return;
        seenActions.add(actionKey);
        uniqueLogs.push(log);
      });

      if (batch.length < NON_SEARCH_BATCH_SIZE) {
        break;
      }
    }

    hasMoreFromDb = uniqueLogs.length > skip + pageSize;
    logsForPage = uniqueLogs.slice(skip, skip + pageSize);
    nonSearchTotalEstimate = skip + logsForPage.length + (hasMoreFromDb ? 1 : 0);
  }

  const mlItemIds = new Set<string>();
  const inventoryItemIds = new Set<string>();
  const normalizedMlByLogId = new Map<string, string | null>();

  logsForPage.forEach((log) => {
    if (typeof log.itemId === "string" && log.itemId.trim().length) {
      inventoryItemIds.add(log.itemId);
    }
    const metadata = (log.metadata ?? {}) as Record<string, any>;
    const itemId = typeof metadata.itemId === "string" ? metadata.itemId : null;
    const payloadResource = typeof metadata.payload?.resource === "string" ? metadata.payload.resource : null;
    const normalizedMl = extractMlItemId(itemId) ?? extractMlItemId(payloadResource);
    normalizedMlByLogId.set(log.id, normalizedMl);
    if (normalizedMl) {
      mlItemIds.add(normalizedMl);
    }
  });

  const inventoryOrFilters: Array<Record<string, any>> = [];
  if (inventoryItemIds.size) {
    inventoryOrFilters.push({ id: { in: Array.from(inventoryItemIds) } });
  }
  if (mlItemIds.size) {
    inventoryOrFilters.push({ mlItemId: { in: Array.from(mlItemIds) } });
  }

  const linkedInventory = inventoryOrFilters.length
    ? await prisma.inventoryItem.findMany({
        where: {
          ownerId: session.user.id,
          OR: inventoryOrFilters
        },
        select: {
          id: true,
          mlItemId: true,
          skuInternal: true,
          title: true,
          extraData: true
        }
      })
    : [];

  const inventoryById = new Map(linkedInventory.map((item) => [item.id, item]));
  const inventoryByMlItemId = new Map(
    linkedInventory
      .filter((item) => typeof item.mlItemId === "string" && item.mlItemId.trim().length)
      .map((item) => [item.mlItemId!.toUpperCase(), item])
  );

  const notifications = logsForPage.map((log) => {
    const metadata = (log.metadata ?? {}) as Record<string, any>;
    const itemId = typeof metadata.itemId === "string" ? metadata.itemId : null;
    const payloadResource = typeof metadata.payload?.resource === "string" ? metadata.payload.resource : null;
    const normalizedMlItemId = normalizedMlByLogId.get(log.id) ?? null;
    const derivedItemId = normalizedMlItemId ?? itemId ?? payloadResource;
    const status = typeof metadata.mappedStatus === "string" ? metadata.mappedStatus : typeof metadata.status === "string" ? metadata.status : null;
    const updated = typeof metadata.updated === "number" ? metadata.updated : null;
    const error = typeof metadata.error === "string" ? metadata.error : null;
    const success = error ? false : updated === null ? true : updated > 0;

    const linkedItem =
      (typeof log.itemId === "string" ? inventoryById.get(log.itemId) : undefined) ??
      (normalizedMlItemId ? inventoryByMlItemId.get(normalizedMlItemId) : undefined);
    const extraData = toExtraData(linkedItem?.extraData);
    const piece =
      readExtraValue(extraData, PIECE_KEYS) ??
      trimOrNull(linkedItem?.title) ??
      trimOrNull(linkedItem?.skuInternal);
    const marca = readExtraValue(extraData, BRAND_KEYS);
    const coche = readExtraValue(extraData, VEHICLE_KEYS);
    const ano = buildYearLabel(extraData);
    const ubicacion = readExtraValue(extraData, LOCATION_KEYS);
    const photos = sanitizePhotosArray(extraData.photos, 1);
    const photoPreview = photos[0] ?? null;
    const skuInternal = linkedItem?.skuInternal ?? null;

    return {
      id: log.id,
      createdAt: log.createdAt.toISOString(),
      itemId: derivedItemId,
      status,
      success,
      piece,
      marca,
      coche,
      ano,
      ubicacion,
      skuInternal,
      photoPreview,
      message: buildMessage({ status, success, error, piece })
    };
  });

  const filteredNotifications = hasSearch
    ? notifications.filter((entry) => {
        const haystack = [
          entry.message,
          entry.itemId ?? "",
          entry.status ?? "",
          entry.piece ?? "",
          entry.skuInternal ?? "",
          entry.marca ?? "",
          entry.coche ?? "",
          entry.ano ?? "",
          entry.ubicacion ?? ""
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(searchTerm);
      })
    : notifications;

  const start = hasSearch ? skip : 0;
  const pagedNotifications = hasSearch
    ? filteredNotifications.slice(start, start + pageSize)
    : filteredNotifications;
  const total = hasSearch ? filteredNotifications.length : nonSearchTotalEstimate;
  const totalPages = hasSearch
    ? Math.max(1, Math.ceil(total / pageSize))
    : hasMoreFromDb
      ? page + 1
      : page;
  const hasMore = hasSearch
    ? start + pagedNotifications.length < filteredNotifications.length
    : hasMoreFromDb;

  return NextResponse.json({
    notifications: pagedNotifications,
    page,
    pageSize,
    total,
    totalPages,
    search: searchTermRaw || null,
    hasMore
  });
}
