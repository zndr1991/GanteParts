import { readFile } from "fs/promises";
import path from "path";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveInventoryLocalUploadAbsolutePath } from "@/lib/inventory-photos";
import { NextResponse } from "next/server";

const contentTypeFromPath = (source: string) => {
  const ext = path.extname(source).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".bmp") return "image/bmp";
  if (ext === ".avif") return "image/avif";
  if (ext === ".svg") return "image/svg+xml";
  return "image/jpeg";
};

const roleIsViewer = (role?: string | null) => {
  const normalized = (role ?? "").toString().trim().toLowerCase();
  return normalized === "viewer";
};

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const itemId = (params.id ?? "").toString().trim();
  if (!itemId.length) {
    return NextResponse.json({ error: "Item invalido" }, { status: 400 });
  }

  if (roleIsViewer(session.user.role)) {
    const owner = await prisma.inventoryItem.findUnique({
      where: { id: itemId },
      select: { ownerId: true }
    });

    if (!owner || owner.ownerId !== session.user.id) {
      return NextResponse.json({ error: "Item no encontrado" }, { status: 404 });
    }
  }

  const { searchParams } = new URL(req.url);
  const rawSource = (searchParams.get("src") ?? "").toString().trim();
  if (!rawSource.length) {
    return NextResponse.json({ error: "Fuente de foto invalida" }, { status: 400 });
  }

  const absolutePath = resolveInventoryLocalUploadAbsolutePath(itemId, rawSource);
  if (!absolutePath) {
    return NextResponse.json({ error: "Fuente de foto invalida" }, { status: 400 });
  }

  try {
    const content = await readFile(absolutePath);
    return new Response(content, {
      headers: {
        "Content-Type": contentTypeFromPath(absolutePath),
        "Cache-Control": "private, max-age=120"
      }
    });
  } catch {
    return NextResponse.json({ error: "Foto no encontrada" }, { status: 404 });
  }
}
