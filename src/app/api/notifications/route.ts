export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { auth } from "@/lib/auth";
import { sanitizePhotosArray } from "@/lib/inventory-serialization";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

const SUPPORTED_ACTIONS = ["ml:webhook"];

const extractMlItemId = (value: unknown) => {
  if (typeof value !== "string") return null;
  const match = value.toUpperCase().match(/MLM\d+/);
  return match ? match[0] : null;
};

const toExtraData = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, any>;
};

function buildMessage(params: {
  itemId: string | null;
  status: string | null;
  success: boolean;
  error: string | null;
}) {
  const { itemId, status, success, error } = params;
  const displayId = itemId ?? "publicacion";
  if (error) {
    return `No se pudo sincronizar ${displayId}: ${error}`;
  }
  if (!success) {
    return `${displayId} no pudo actualizarse en la base interna`;
  }
  if (!status) {
    return `${displayId} se sincronizo`; 
  }
  const verb =
    status === "active"
      ? "se activo"
      : status === "paused"
        ? "se pauso"
        : status === "inactive"
          ? "se inactivo"
          : "cambio de estado";
  return `${displayId} ${verb}`;
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const limitParam = Number(searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(Math.floor(limitParam), 1), 50) : 12;

  const logs = await prisma.auditLog.findMany({
    where: {
      userId: session.user.id,
      action: { in: SUPPORTED_ACTIONS }
    },
    orderBy: { createdAt: "desc" },
    take: limit
  });

  const mlItemIds = new Set<string>();
  const inventoryItemIds = new Set<string>();
  const normalizedMlByLogId = new Map<string, string | null>();

  logs.forEach((log) => {
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

  const notifications = logs.map((log) => {
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
    const rawPiece = (extraData.pieza ?? "").toString().trim();
    const piece = rawPiece.length ? rawPiece : linkedItem?.title ?? null;
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
      skuInternal,
      photoPreview,
      message: buildMessage({ itemId: derivedItemId, status, success, error })
    };
  });

  return NextResponse.json({ notifications });
}
