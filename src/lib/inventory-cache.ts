import { unstable_cache } from "next/cache";
import { Prisma } from "@prisma/client";
import type { InventoryClientItem } from "@/app/inventory/client";
import { serializeInventoryListRow, type InventoryListRow } from "@/lib/inventory-full-snapshot";
import { prisma } from "@/lib/prisma";
import { serializeInventoryItem } from "@/lib/inventory-serialization";
import { fetchInventoryItemsSafely } from "@/lib/inventory-safe-load";

const INVENTORY_PAGE_SIZE = 50;
const INVENTORY_INITIAL_LOAD_ENV = Number(
  process.env.INVENTORY_INITIAL_LOAD_LIMIT ?? process.env.INVENTORY_FULL_LOAD_LIMIT ?? `${INVENTORY_PAGE_SIZE}`
);
const MAX_CACHE_TAKE =
  Number.isFinite(INVENTORY_INITIAL_LOAD_ENV) && INVENTORY_INITIAL_LOAD_ENV > 0
    ? Math.min(Math.floor(INVENTORY_INITIAL_LOAD_ENV), INVENTORY_PAGE_SIZE)
    : INVENTORY_PAGE_SIZE;
const INVENTORY_SNAPSHOT_TIMEOUT_MS_ENV = Number(process.env.INVENTORY_SNAPSHOT_TIMEOUT_MS ?? "9000");
const INVENTORY_SNAPSHOT_TIMEOUT_MS =
  Number.isFinite(INVENTORY_SNAPSHOT_TIMEOUT_MS_ENV) && INVENTORY_SNAPSHOT_TIMEOUT_MS_ENV > 0
    ? Math.min(INVENTORY_SNAPSHOT_TIMEOUT_MS_ENV, 12000)
    : 9000;
const INVENTORY_STALE_SNAPSHOT_MAX_AGE_MS = 10 * 60 * 1000;

type InventorySnapshotResult = {
  items: InventoryClientItem[];
  total: number;
  statusTotals: Record<string, number>;
  skippedCount: number;
  complete: boolean;
  truncated: boolean;
};

type InventorySnapshotCacheEntry = InventorySnapshotResult & {
  updatedAt: number;
};

const lastInventorySnapshotByScope = new Map<string, InventorySnapshotCacheEntry>();

const buildInventorySnapshotScopeKey = (ownerId: string | null) => ownerId ?? "*";

const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }

  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(`inventory snapshot timeout (${timeoutMs}ms)`));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
};

type InventoryWhere = { ownerId: string } | undefined;

const resolveSnapshotWhere = (ownerId: string | null): InventoryWhere => {
  return ownerId ? { ownerId } : undefined;
};

const resolveRequestedTake = (take: number) => {
  if (!Number.isFinite(take) || take <= 0) return MAX_CACHE_TAKE;
  return Math.min(Math.floor(take), MAX_CACHE_TAKE);
};

const resolveManualRequestedTake = (take: number) => {
  if (!Number.isFinite(take) || take <= 0) return INVENTORY_PAGE_SIZE;
  return Math.floor(take);
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

type StatusCountRow = {
  label: string | null;
  count: number | bigint | string;
};

const queryStatusTotals = async (ownerId: string | null) => {
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

const fetchInventorySnapshot = unstable_cache(
  async (ownerId: string | null, take: number): Promise<InventorySnapshotResult> => {
    const where = resolveSnapshotWhere(ownerId);
    const requested = resolveRequestedTake(take);

    const [total, plainItems, statusTotals] = await Promise.all([
      prisma.inventoryItem.count({ where }),
      loadLightweightInitialRows(ownerId, requested),
      queryStatusTotals(ownerId)
    ]);

    const truncated = plainItems.length < total;
    return {
      items: plainItems,
      total,
      statusTotals,
      skippedCount: 0,
      complete: !truncated,
      truncated
    };
  },
  ["inventory-initial"],
  { revalidate: 45, tags: ["inventory-initial"] }
);

export const getInventorySnapshot = async (ownerId: string | null, take?: number) => {
  const scopeKey = buildInventorySnapshotScopeKey(ownerId ?? null);
  const where = resolveSnapshotWhere(ownerId);
  const requested = resolveRequestedTake(take ?? MAX_CACHE_TAKE);

  try {
    const payload = await withTimeout(
      fetchInventorySnapshot(ownerId ?? null, requested),
      INVENTORY_SNAPSHOT_TIMEOUT_MS
    );

    lastInventorySnapshotByScope.set(scopeKey, {
      ...payload,
      updatedAt: Date.now()
    });
    return payload;
  } catch (error) {
    const stale = lastInventorySnapshotByScope.get(scopeKey);
    if (stale && Date.now() - stale.updatedAt <= INVENTORY_STALE_SNAPSHOT_MAX_AGE_MS) {
      console.warn("[inventory-cache] using stale snapshot fallback", {
        scopeKey,
        ageMs: Date.now() - stale.updatedAt
      });

      return {
        items: stale.items,
        total: stale.total,
        statusTotals: stale.statusTotals,
        skippedCount: stale.skippedCount,
        complete: stale.complete,
        truncated: stale.truncated
      };
    }

    try {
      const fallbackTake = Math.max(1, Math.min(requested, INVENTORY_PAGE_SIZE));
      const [fallbackRows, fallbackTotal, fallbackStatusTotals] = await Promise.all([
        loadLightweightInitialRows(ownerId, fallbackTake),
        prisma.inventoryItem.count({ where }).catch(() => 0),
        queryStatusTotals(ownerId).catch(() => ({} as Record<string, number>))
      ]);
      if (fallbackRows.length > 0) {
        const resolvedTotal = fallbackTotal > 0 ? fallbackTotal : fallbackRows.length;
        const resolvedStatusTotals =
          Object.keys(fallbackStatusTotals).length > 0
            ? fallbackStatusTotals
            : buildStatusTotalsFromItems(fallbackRows);
        const payload: InventorySnapshotResult = {
          items: fallbackRows,
          total: resolvedTotal,
          statusTotals: resolvedStatusTotals,
          skippedCount: 0,
          complete: fallbackRows.length >= resolvedTotal,
          truncated: fallbackRows.length < resolvedTotal
        };
        lastInventorySnapshotByScope.set(scopeKey, {
          ...payload,
          updatedAt: Date.now()
        });
        console.warn("[inventory-cache] emergency lightweight fallback", {
          scopeKey,
          fallbackRows: fallbackRows.length
        });
        return payload;
      }
    } catch (fallbackError) {
      console.error("[inventory-cache] emergency lightweight fallback failed", fallbackError);
    }

    try {
      const fallbackTake = Math.max(1, Math.min(requested, INVENTORY_PAGE_SIZE));
      const [safeItems, fallbackTotal, fallbackStatusTotals] = await Promise.all([
        fetchInventoryItemsSafely({
          where,
          take: fallbackTake
        }),
        prisma.inventoryItem.count({ where }).catch(() => 0),
        queryStatusTotals(ownerId).catch(() => ({} as Record<string, number>))
      ]);
      const fallbackRows = safeItems.items.map((item) => serializeInventoryItem(item) as InventoryClientItem);
      if (fallbackRows.length > 0) {
        const resolvedTotal = fallbackTotal > 0 ? fallbackTotal : fallbackRows.length;
        const resolvedStatusTotals =
          Object.keys(fallbackStatusTotals).length > 0
            ? fallbackStatusTotals
            : buildStatusTotalsFromItems(fallbackRows);
        const payload: InventorySnapshotResult = {
          items: fallbackRows,
          total: resolvedTotal,
          statusTotals: resolvedStatusTotals,
          skippedCount: safeItems.skippedIds.length,
          complete: fallbackRows.length >= resolvedTotal,
          truncated: fallbackRows.length < resolvedTotal
        };
        lastInventorySnapshotByScope.set(scopeKey, {
          ...payload,
          updatedAt: Date.now()
        });
        console.warn("[inventory-cache] emergency safe fallback", {
          scopeKey,
          fallbackRows: fallbackRows.length,
          skipped: safeItems.skippedIds.length
        });
        return payload;
      }
    } catch (safeFallbackError) {
      console.error("[inventory-cache] emergency safe fallback failed", safeFallbackError);
    }

    console.error("[inventory-cache] snapshot fallback", error);

    return {
      items: [],
      total: 0,
      statusTotals: {},
      skippedCount: 0,
      complete: false,
      truncated: false
    };
  }
};

const fetchManualInventorySnapshot = unstable_cache(
  async (ownerId: string | null, take: number) => {
    const where = resolveSnapshotWhere(ownerId);
    const requested = resolveManualRequestedTake(take);

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
