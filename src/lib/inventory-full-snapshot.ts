import { Prisma } from "@prisma/client";

import { toInventoryPhotoClientSrc } from "@/lib/inventory-photos";
import { prisma } from "@/lib/prisma";
import { sanitizePhotosArray, serializeInventoryItem } from "@/lib/inventory-serialization";

const DEFAULT_FULL_LOAD_LIMIT = 0;
const FULL_LOAD_LIMIT_ENV = Number(
  process.env.INVENTORY_BULK_LOAD_LIMIT ?? process.env.INVENTORY_FULL_LOAD_LIMIT ?? `${DEFAULT_FULL_LOAD_LIMIT}`
);
const FULL_LOAD_LIMIT =
  Number.isFinite(FULL_LOAD_LIMIT_ENV) && FULL_LOAD_LIMIT_ENV > 0
    ? Math.floor(FULL_LOAD_LIMIT_ENV)
    : DEFAULT_FULL_LOAD_LIMIT;

const FULL_SNAPSHOT_TTL_MS = 90 * 1000;

export type InventoryListRow = {
  id: string;
  skuInternal: string;
  sellerCustomField: string | null;
  title: string | null;
  price: any;
  stock: number | bigint;
  status: string;
  mlItemId: string | null;
  photoPreview: unknown;
  extraData: any;
  photoCount: number | bigint;
  createdAt: Date;
  updatedAt: Date;
};

export type InventorySnapshotItem = ReturnType<typeof serializeInventoryItem> & {
  photoCount: number;
  photoPreview: string | null;
};

export type InventoryFullSnapshot = {
  items: InventorySnapshotItem[];
  total: number;
  statusTotals: Record<string, number>;
  skippedCount: number;
  truncated: boolean;
  complete: boolean;
};

type SnapshotCacheEntry = {
  value: InventoryFullSnapshot;
  expiresAt: number;
};

const snapshotCache = new Map<string, SnapshotCacheEntry>();
const snapshotInFlight = new Map<string, Promise<InventoryFullSnapshot>>();

const snapshotCacheKey = (ownerId: string | null) => ownerId ?? "__ALL__";

const normalizeStatusLabel = (value: unknown) => {
  const raw = (value ?? "").toString().trim().toUpperCase();
  return raw.length ? raw : "SIN ESTATUS";
};

export const invalidateInventoryFullSnapshot = () => {
  snapshotCache.clear();
  snapshotInFlight.clear();
};

const buildStatusTotals = (items: InventorySnapshotItem[]) => {
  const totals: Record<string, number> = {};
  items.forEach((item) => {
    const key = normalizeStatusLabel(item.extraData?.estatus_interno);
    totals[key] = (totals[key] ?? 0) + 1;
  });
  return totals;
};

export const serializeInventoryListRow = (rawRow: InventoryListRow): InventorySnapshotItem => {
  const result = serializeInventoryItem(rawRow) as InventorySnapshotItem;
  result.photoCount = Number(rawRow.photoCount ?? 0);
  const previewSource = sanitizePhotosArray(rawRow.photoPreview, 1)[0] ?? null;
  result.photoPreview = previewSource ? toInventoryPhotoClientSrc(rawRow.id, previewSource) : null;
  return result;
};

const loadInventoryFullSnapshot = async (ownerId: string | null): Promise<InventoryFullSnapshot> => {
  const ownerSql = ownerId ? Prisma.sql`AND "ownerId" = ${ownerId}` : Prisma.empty;
  const where = ownerId ? { ownerId } : undefined;

  const total = await prisma.inventoryItem.count({ where });
  if (total === 0) {
    return {
      items: [],
      total: 0,
      statusTotals: {},
      skippedCount: 0,
      truncated: false,
      complete: true
    };
  }

  const shouldTruncate = FULL_LOAD_LIMIT > 0 && total > FULL_LOAD_LIMIT;
  const limitSql = shouldTruncate ? Prisma.sql`LIMIT ${FULL_LOAD_LIMIT}` : Prisma.empty;

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
    ${limitSql}
  `);

  const items = rows.map(serializeInventoryListRow);
  return {
    items,
    total,
    statusTotals: buildStatusTotals(items),
    skippedCount: 0,
    truncated: shouldTruncate,
    complete: !shouldTruncate
  };
};

export const getInventoryFullSnapshot = async (ownerId: string | null): Promise<InventoryFullSnapshot> => {
  const key = snapshotCacheKey(ownerId);
  const now = Date.now();
  const cached = snapshotCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const inflight = snapshotInFlight.get(key);
  if (inflight) {
    return inflight;
  }

  const task = loadInventoryFullSnapshot(ownerId)
    .then((value) => {
      snapshotCache.set(key, {
        value,
        expiresAt: Date.now() + FULL_SNAPSHOT_TTL_MS
      });
      return value;
    })
    .finally(() => {
      snapshotInFlight.delete(key);
    });

  snapshotInFlight.set(key, task);
  return task;
};
