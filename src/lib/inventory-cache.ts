import { unstable_cache } from "next/cache";
import type { InventoryClientItem } from "@/app/inventory/client";
import { prisma } from "@/lib/prisma";
import { INVENTORY_LIST_SELECT, serializeInventoryItem } from "@/lib/inventory-serialization";
import { Prisma } from "@prisma/client";

const INVENTORY_INITIAL_LOAD_ENV = Number(
  process.env.INVENTORY_INITIAL_LOAD_LIMIT ?? process.env.INVENTORY_FULL_LOAD_LIMIT ?? "100"
);
const MAX_CACHE_TAKE =
  Number.isFinite(INVENTORY_INITIAL_LOAD_ENV) && INVENTORY_INITIAL_LOAD_ENV > 0 ? INVENTORY_INITIAL_LOAD_ENV : 100;

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
    const where = ownerId ? { ownerId } : undefined;
    const requested = Number.isFinite(take) && take > 0 ? take : MAX_CACHE_TAKE;
    const limit = Math.max(1, Math.min(requested, MAX_CACHE_TAKE));

    const [items, total, statusTotals] = await Promise.all([
      prisma.inventoryItem.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        take: limit,
        select: INVENTORY_LIST_SELECT
      }),
      prisma.inventoryItem.count({ where }),
      getStatusTotals(ownerId)
    ]);

    return {
      items: items.map((item) => serializeInventoryItem(item) as InventoryClientItem),
      total,
      statusTotals
    };
  },
  ["inventory-initial"],
  { revalidate: 45, tags: ["inventory-initial"] }
);

export const getInventorySnapshot = async (ownerId: string | null, take: number) => {
  return fetchInventorySnapshot(ownerId ?? null, take);
};
