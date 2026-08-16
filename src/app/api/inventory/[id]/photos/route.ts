import { auth } from "@/lib/auth";
import { toInventoryPhotoClientSrc } from "@/lib/inventory-photos";
import { prisma } from "@/lib/prisma";
import { MAX_ITEM_PHOTOS, sanitizePhotosArray } from "@/lib/inventory-serialization";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

const INVENTORY_ITEM_PHOTOS_TIMEOUT_MS_ENV = Number(process.env.INVENTORY_ITEM_PHOTOS_TIMEOUT_MS ?? "1800");
const INVENTORY_ITEM_PHOTOS_TIMEOUT_MS =
  Number.isFinite(INVENTORY_ITEM_PHOTOS_TIMEOUT_MS_ENV) && INVENTORY_ITEM_PHOTOS_TIMEOUT_MS_ENV > 0
    ? Math.min(INVENTORY_ITEM_PHOTOS_TIMEOUT_MS_ENV, 8000)
    : 1800;
const INVENTORY_ITEM_PHOTOS_CACHE_TTL_MS = 60_000;

type ItemPhotosCacheEntry = {
  photos: string[];
  expiresAt: number;
};

const itemPhotosCache = new Map<string, ItemPhotosCacheEntry>();

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
          reject(new Error(`inventory item photos timeout (${timeoutMs}ms)`));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
};

const pruneItemPhotosCache = () => {
  const now = Date.now();
  for (const [key, entry] of itemPhotosCache.entries()) {
    if (entry.expiresAt <= now) {
      itemPhotosCache.delete(key);
    }
  }

  while (itemPhotosCache.size > 2000) {
    const oldestKey = itemPhotosCache.keys().next().value;
    if (!oldestKey) break;
    itemPhotosCache.delete(oldestKey);
  }
};

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const parsedLimit = Number.parseInt(searchParams.get("limit") ?? `${MAX_ITEM_PHOTOS}`, 10);
  const limit = Number.isFinite(parsedLimit)
    ? Math.max(1, Math.min(parsedLimit, MAX_ITEM_PHOTOS))
    : MAX_ITEM_PHOTOS;

  const role = (session.user.role ?? "").toLowerCase();
  const scopeKey = role === "viewer" ? session.user.id : "*";
  const cacheKey = `${scopeKey}|${params.id}|${limit}`;

  const cached = itemPhotosCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json({ photos: cached.photos });
  }

  type PhotoRow = { id: string; photos: unknown };
  let item: PhotoRow | null = null;

  try {
    const ownerSql = role === "viewer" ? Prisma.sql`AND "ownerId" = ${session.user.id}` : Prisma.empty;
    const rows = await withTimeout(
      prisma.$queryRaw<PhotoRow[]>(Prisma.sql`
        SELECT id, COALESCE("extraData"->'photos', '[]'::jsonb) AS photos
        FROM "InventoryItem"
        WHERE id = ${params.id}
        ${ownerSql}
        LIMIT 1
      `),
      INVENTORY_ITEM_PHOTOS_TIMEOUT_MS
    );
    item = rows[0] ?? null;
  } catch (error) {
    console.error("[inventory-photos] fallback", error);
    return NextResponse.json({ photos: [] });
  }

  if (!item) {
    return NextResponse.json({ error: "Item no encontrado" }, { status: 404 });
  }

  const photos = sanitizePhotosArray(item.photos, limit).map((source) =>
    toInventoryPhotoClientSrc(params.id, source)
  );

  itemPhotosCache.set(cacheKey, {
    photos,
    expiresAt: Date.now() + INVENTORY_ITEM_PHOTOS_CACHE_TTL_MS
  });
  pruneItemPhotosCache();

  return NextResponse.json({ photos });
}
