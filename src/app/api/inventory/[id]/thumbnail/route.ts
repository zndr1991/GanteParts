import { auth } from "@/lib/auth";
import { isInventoryLocalUploadPath, normalizeInventoryPhotoSource, toInventoryPhotoClientSrc } from "@/lib/inventory-photos";
import { MAX_ITEM_PHOTOS, sanitizePhotosArray } from "@/lib/inventory-serialization";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const DATA_IMAGE_PATTERN = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/;

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const role = (session.user.role ?? "").toLowerCase();
  const where = role === "viewer" ? { id: params.id, ownerId: session.user.id } : { id: params.id };

  const item = await prisma.inventoryItem.findFirst({
    where,
    select: {
      id: true,
      updatedAt: true,
      extraData: true
    }
  });

  if (!item) {
    return NextResponse.json({ error: "Item no encontrado" }, { status: 404 });
  }

  const photos = sanitizePhotosArray((item.extraData as any)?.photos, Math.min(1, MAX_ITEM_PHOTOS));
  const primaryPhoto = photos[0];

  if (!primaryPhoto) {
    return NextResponse.json({ error: "Item sin fotos" }, { status: 404 });
  }

  const normalizedSource = normalizeInventoryPhotoSource(primaryPhoto);

  const etag = `"${item.id}:${new Date(item.updatedAt).getTime()}"`;
  if (req.headers.get("if-none-match") === etag) {
    return new NextResponse(null, {
      status: 304,
      headers: {
        ETag: etag,
        "Cache-Control": "private, max-age=86400, stale-while-revalidate=604800"
      }
    });
  }

  if (normalizedSource.startsWith("http://") || normalizedSource.startsWith("https://")) {
    return NextResponse.redirect(normalizedSource, 307);
  }

  if (isInventoryLocalUploadPath(normalizedSource)) {
    return NextResponse.redirect(new URL(toInventoryPhotoClientSrc(item.id, normalizedSource), req.url), 307);
  }

  if (normalizedSource.startsWith("/")) {
    return NextResponse.redirect(new URL(normalizedSource, req.url), 307);
  }

  const dataMatch = normalizedSource.match(DATA_IMAGE_PATTERN);
  if (!dataMatch) {
    return NextResponse.json({ error: "Formato de imagen no soportado" }, { status: 415 });
  }

  const mimeType = dataMatch[1];
  const base64Payload = dataMatch[2];

  let binaryData: Buffer;
  try {
    binaryData = Buffer.from(base64Payload, "base64");
  } catch {
    return NextResponse.json({ error: "Imagen invalida" }, { status: 400 });
  }

  return new NextResponse(binaryData, {
    status: 200,
    headers: {
      "Content-Type": mimeType,
      "Content-Length": String(binaryData.byteLength),
      ETag: etag,
      "Cache-Control": "private, max-age=86400, stale-while-revalidate=604800"
    }
  });
}
