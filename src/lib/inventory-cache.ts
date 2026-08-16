import { unstable_cache } from "next/cache";
import { Prisma } from "@prisma/client";
import type { InventoryClientItem } from "@/app/inventory/client";
import { getCachedInventoryFullSnapshot, serializeInventoryListRow, type InventoryListRow } from "@/lib/inventory-full-snapshot";
import { prisma } from "@/lib/prisma";
import { serializeInventoryItem } from "@/lib/inventory-serialization";
import { fetchInventoryItemsSafely } from "@/lib/inventory-safe-load";

const INVENTORY_PAGE_SIZE = 50;
const MAX_INITIAL_PAGE_SIZE = 5000;
const INVENTORY_INITIAL_LOAD_ENV = Number(
  process.env.INVENTORY_INITIAL_LOAD_LIMIT ?? process.env.INVENTORY_FULL_LOAD_LIMIT ?? `${INVENTORY_PAGE_SIZE}`
);
const MAX_CACHE_TAKE =
  Number.isFinite(INVENTORY_INITIAL_LOAD_ENV) && INVENTORY_INITIAL_LOAD_ENV > 0
    ? Math.min(Math.floor(INVENTORY_INITIAL_LOAD_ENV), MAX_INITIAL_PAGE_SIZE)
    : INVENTORY_PAGE_SIZE;
const INVENTORY_SNAPSHOT_TIMEOUT_MS_ENV = Number(process.env.INVENTORY_SNAPSHOT_TIMEOUT_MS ?? "4500");
const INVENTORY_SNAPSHOT_TIMEOUT_MS =
  Number.isFinite(INVENTORY_SNAPSHOT_TIMEOUT_MS_ENV) && INVENTORY_SNAPSHOT_TIMEOUT_MS_ENV > 0
    ? Math.min(INVENTORY_SNAPSHOT_TIMEOUT_MS_ENV, 12000)
    : 4500;
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
  const scopeKey = buildInventorySnapshotScopeKey(ownerId ?? null);
  const snapshot = getCachedInventoryFullSnapshot(ownerId);
  if (snapshot) {
    const payload: InventorySnapshotResult = {
      items: snapshot.items as InventoryClientItem[],
      total: snapshot.total,
      statusTotals: snapshot.statusTotals,
      skippedCount: snapshot.skippedCount,
      complete: snapshot.complete,
      truncated: snapshot.truncated
    };
    lastInventorySnapshotByScope.set(scopeKey, {
      ...payload,
      updatedAt: Date.now()
    });
    return payload;
  }

  const where = resolveSnapshotWhere(ownerId);
  const requested = resolveRequestedTake(take ?? MAX_CACHE_TAKE);

  try {
    const [total, plainItems] = await withTimeout(
      Promise.all([
        prisma.inventoryItem.count({ where }),
        loadLightweightInitialRows(ownerId, requested)
      ]),
      INVENTORY_SNAPSHOT_TIMEOUT_MS
    );

    const truncated = plainItems.length < total;
    const payload: InventorySnapshotResult = {
      items: plainItems,
      total,
      statusTotals: buildStatusTotalsFromItems(plainItems),
      skippedCount: 0,
      complete: !truncated,
      truncated
    };
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
