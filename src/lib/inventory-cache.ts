import { unstable_cache } from "next/cache";
import type { InventoryClientItem } from "@/app/inventory/client";
import { getCachedInventoryFullSnapshot, getInventoryFullSnapshot } from "@/lib/inventory-full-snapshot";
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

  // Calienta snapshot completo para requests subsecuentes sin bloquear esta respuesta SSR.
  void getInventoryFullSnapshot(ownerId).catch(() => undefined);

  const where = resolveSnapshotWhere(ownerId);
  const requested = resolveRequestedTake(take ?? MAX_CACHE_TAKE);
  const [total, safeItems] = await Promise.all([
    prisma.inventoryItem.count({ where }),
    fetchInventoryItemsSafely({
      where,
      take: requested
    })
  ]);

  const plainItems = safeItems.items.map((item) => serializeInventoryItem(item) as InventoryClientItem);
  const truncated = plainItems.length < total;
  const statusTotals = buildStatusTotalsFromItems(plainItems);

  if (safeItems.skippedIds.length) {
    console.error(`Inventory snapshot omitio ${safeItems.skippedIds.length} registros con texto invalido`);
  }

  return {
    items: plainItems,
    total,
    statusTotals,
    skippedCount: safeItems.skippedIds.length,
    complete: !truncated,
    truncated
  };
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
