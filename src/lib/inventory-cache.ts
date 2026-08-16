import { unstable_cache } from "next/cache";
import { Prisma } from "@prisma/client";
import type { InventoryClientItem } from "@/app/inventory/client";
import { getCachedInventoryFullSnapshot, serializeInventoryListRow, type InventoryListRow } from "@/lib/inventory-full-snapshot";
import { prisma } from "@/lib/prisma";
import { serializeInventoryItem } from "@/lib/inventory-serialization";
import { fetchInventoryItemsSafely } from "@/lib/inventory-safe-load";

const INVENTORY_PAGE_SIZE = 40;
const MAX_INITIAL_PAGE_SIZE = 5000;
const INVENTORY_INITIAL_LOAD_ENV = Number(
  process.env.INVENTORY_INITIAL_LOAD_LIMIT ?? process.env.INVENTORY_FULL_LOAD_LIMIT ?? `${INVENTORY_PAGE_SIZE}`
);
const MAX_CACHE_TAKE =
  Number.isFinite(INVENTORY_INITIAL_LOAD_ENV) && INVENTORY_INITIAL_LOAD_ENV > 0
    ? Math.min(Math.floor(INVENTORY_INITIAL_LOAD_ENV), MAX_INITIAL_PAGE_SIZE)
    : INVENTORY_PAGE_SIZE;

type InventoryWhere = { ownerId: string } | undefined;

const resolveSnapshotWhere = (ownerId: string | null): InventoryWhere => {
  return ownerId ? { ownerId } : undefined;
};

const resolveRequestedTake = (take: number) => {
  return Number.isFinite(take) && take > 0 ? Math.floor(take) : MAX_CACHE_TAKE;
};

const normalizeStatusLabel = (value: unknown) => {
  const raw = (value ?? "").toString().trim().toUpperCase();
  return raw.length ? raw : "SIN ESTATUS";
};

const buildStatusTotalsFromItems = (items: InventoryClientItem[]) => {
  const totals: Record<string, number> = {};
  items.forEach((item) => {
    const key = normalizeStatusLabel(item.extraData?.estatus_interno);
    totals[key] = (totals[key] ?? 0) + 1;
  });
  return totals;
};

const loadLightweightInitialRows = async (ownerId: string | null, take: number) => {
  const ownerSql = ownerId ? Prisma.sql`AND "ownerId" = ${ownerId}` : Prisma.empty;

  const rows = await prisma.$queryRaw<InventoryListRow[]>(Prisma.sql`
    SELECT
      "id", "skuInternal", "sellerCustomField", "title", "price", "stock",
      "status", "mlItemId",
      CASE
        WHEN jsonb_typeof("extraData"->'photos') = 'array' THEN "extraData"->'photos'->0
        ELSE NULL
      END AS "photoPreview",
      ("extraData" - 'photos') AS "extraData",
      COALESCE(
        CASE
          WHEN jsonb_typeof("extraData"->'photos') = 'array' THEN jsonb_array_length("extraData"->'photos')
          ELSE 0
        END,
        0
      )::int AS "photoCount",
      "createdAt", "updatedAt"
    FROM "InventoryItem"
    WHERE 1=1
    ${ownerSql}
    ORDER BY "updatedAt" DESC
    LIMIT ${take}
  `);

  return rows.map((row) => serializeInventoryListRow(row) as InventoryClientItem);
};

export const getInventorySnapshot = async (ownerId: string | null, take?: number) => {
  const snapshot = getCachedInventoryFullSnapshot(ownerId);
  if (snapshot) {
    return {
      items: snapshot.items as InventoryClientItem[],
      total: snapshot.total,
      statusTotals: snapshot.statusTotals,
      skippedCount: snapshot.skippedCount,
      complete: snapshot.complete,
      truncated: snapshot.truncated
    };
  }

  const where = resolveSnapshotWhere(ownerId);
  const requested = resolveRequestedTake(take ?? MAX_CACHE_TAKE);

  try {
    const [total, plainItems] = await Promise.all([
      prisma.inventoryItem.count({ where }),
      loadLightweightInitialRows(ownerId, requested)
    ]);

    const truncated = plainItems.length < total;
    return {
      items: plainItems,
      total,
      statusTotals: buildStatusTotalsFromItems(plainItems),
      skippedCount: 0,
      complete: !truncated,
      truncated
    };
  } catch (error) {
    const [total, safeItems] = await Promise.all([
      prisma.inventoryItem.count({ where }),
      fetchInventoryItemsSafely({
        where,
        take: requested
      })
    ]);

    const plainItems = safeItems.items.map((item) => serializeInventoryItem(item) as InventoryClientItem);
    const truncated = plainItems.length < total;
    if (safeItems.skippedIds.length) {
      console.error(`Inventory snapshot omitio ${safeItems.skippedIds.length} registros con texto invalido`);
    }
    console.error("Fallback a safe snapshot en inventario", error);

    return {
      items: plainItems,
      total,
      statusTotals: buildStatusTotalsFromItems(plainItems),
      skippedCount: safeItems.skippedIds.length,
      complete: !truncated,
      truncated
    };
  }
};

const fetchManualInventorySnapshot = unstable_cache(
  async (ownerId: string | null, take: number) => {
    const where = resolveSnapshotWhere(ownerId);
    const requested = resolveRequestedTake(take);

    const { items, skippedIds } = await fetchInventoryItemsSafely({
      where,
      take: requested
    });

    if (skippedIds.length) {
      console.error(`Inventory manual snapshot omitio ${skippedIds.length} registros con texto invalido`);
    }

    return {
      items: items.map((item) => serializeInventoryItem(item) as InventoryClientItem),
      skippedCount: skippedIds.length
    };
  },
  ["inventory-manual-initial"],
  { revalidate: 45, tags: ["inventory-initial"] }
);

export const getManualInventorySnapshot = async (ownerId: string | null, take: number) => {
  return fetchManualInventorySnapshot(ownerId ?? null, take);
};
