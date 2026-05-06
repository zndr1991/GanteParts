import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { INVENTORY_LIST_SELECT } from "@/lib/inventory-serialization";

const SAFE_FETCH_BATCH_SIZE = 600;

const toErrorMessage = (error: unknown) => {
  if (!error) return "";
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

const isStringDecodeFailure = (error: unknown) => {
  const code = (error as { code?: string } | null)?.code ?? "";
  const message = toErrorMessage(error);
  return code === "GenericFailure" && message.includes("Failed to convert rust `String` into napi `string`");
};

type InventoryListItem = Prisma.InventoryItemGetPayload<{ select: typeof INVENTORY_LIST_SELECT }>;

type FetchInventoryItemsSafelyParams = {
  where?: Prisma.InventoryItemWhereInput;
  take?: number;
};

export const fetchInventoryItemsSafely = async ({
  where,
  take
}: FetchInventoryItemsSafelyParams): Promise<{ items: InventoryListItem[]; skippedIds: string[] }> => {
  const idRows = await prisma.inventoryItem.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    select: { id: true },
    ...(take && take > 0 ? { take } : {})
  });

  const orderedIds = idRows.map((row) => row.id);
  if (!orderedIds.length) {
    return { items: [], skippedIds: [] };
  }

  const skippedIds: string[] = [];
  const collected: InventoryListItem[] = [];

  const loadChunkSafely = async (ids: string[]): Promise<void> => {
    if (!ids.length) return;

    try {
      const rows = await prisma.inventoryItem.findMany({
        where: {
          ...(where ?? {}),
          id: { in: ids }
        },
        select: INVENTORY_LIST_SELECT
      });
      collected.push(...rows);
    } catch (error) {
      if (!isStringDecodeFailure(error)) {
        throw error;
      }

      if (ids.length === 1) {
        skippedIds.push(ids[0]);
        return;
      }

      const middle = Math.floor(ids.length / 2);
      await loadChunkSafely(ids.slice(0, middle));
      await loadChunkSafely(ids.slice(middle));
    }
  };

  for (let index = 0; index < orderedIds.length; index += SAFE_FETCH_BATCH_SIZE) {
    const chunk = orderedIds.slice(index, index + SAFE_FETCH_BATCH_SIZE);
    await loadChunkSafely(chunk);
  }

  const indexById = new Map(orderedIds.map((id, index) => [id, index]));
  collected.sort((a, b) => {
    const left = indexById.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const right = indexById.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    return left - right;
  });

  return { items: collected, skippedIds };
};
