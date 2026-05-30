import { unstable_cache } from "next/cache";
import type { InventoryClientItem } from "@/app/inventory/client";
import { prisma } from "@/lib/prisma";
import { serializeInventoryItem } from "@/lib/inventory-serialization";
import { Prisma } from "@prisma/client";
import { fetchInventoryItemsSafely } from "@/lib/inventory-safe-load";

const INVENTORY_PAGE_SIZE = 120;
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

type StatusCountRow = {
  label: string | null;
  count: number | bigint | string;
};

const getStatusTotals = async (ownerId: string | null) => {
  const whereSql = ownerId ? Prisma.sql`WHERE "ownerId" = ${ownerId}` : Prisma.empty;
  const rows = await prisma.$queryRaw<StatusCountRow[]>(Prisma.sql`
    SELECT
      COALESCE(NULLIF(UPPER(TRIM("extraData"->>'estatus_interno')), ''), 'SIN ESTATUS') AS label,
      COUNT(*) AS count
    FROM "InventoryItem"
    ${whereSql}
    GROUP BY 1
  `);

  const totals: Record<string, number> = {};
  rows.forEach((row) => {
    const key = (row.label ?? "").toString().trim().toUpperCase() || "SIN ESTATUS";
    const parsedCount = Number(row.count ?? 0);
    if (!Number.isFinite(parsedCount) || parsedCount <= 0) return;
    totals[key] = Math.round(parsedCount);
  });

  return totals;
};

const fetchInventorySnapshot = unstable_cache(
  async (ownerId: string | null, take: number) => {
    const where = resolveSnapshotWhere(ownerId);
    const requested = resolveRequestedTake(take);

    const total = await prisma.inventoryItem.count({ where });
    const statusTotals = await getStatusTotals(ownerId);

    const limit = requested > 0 ? Math.min(requested, total) : total;

    const { items, skippedIds } = await fetchInventoryItemsSafely({
      where,
      take: limit
    });

    if (skippedIds.length) {
      console.error(`Inventory snapshot omitio ${skippedIds.length} registros con texto invalido`);
    }

    return {
      items: items.map((item) => serializeInventoryItem(item) as InventoryClientItem),
      total,
      statusTotals,
      skippedCount: skippedIds.length
    };
  },
  ["inventory-initial"],
  { revalidate: 45, tags: ["inventory-initial"] }
);

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

export const getInventorySnapshot = async (ownerId: string | null, take: number) => {
  return fetchInventorySnapshot(ownerId ?? null, take);
};

export const getManualInventorySnapshot = async (ownerId: string | null, take: number) => {
  return fetchManualInventorySnapshot(ownerId ?? null, take);
};
