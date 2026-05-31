export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

const canManageNomenclatures = (role?: string | null) => {
  const normalized = (role ?? "").toLowerCase();
  return (
    normalized === "admin" ||
    normalized === "supervisor" ||
    normalized === "operator" ||
    normalized === "uploader"
  );
};

const normalizePrefix = (value: string) =>
  value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 12);

const normalizePiece = (value: string) => value.trim().toUpperCase().replace(/\s+/g, " ");

const createNomenclatureSchema = z.object({
  prefix: z.string().min(1)
});

const addPieceSchema = z.object({
  nomenclatureId: z.string().min(1),
  piece: z.string().min(1)
});

const deleteSchema = z
  .object({
    nomenclatureId: z.string().min(1).optional(),
    pieceId: z.string().min(1).optional()
  })
  .refine((value) => Boolean(value.nomenclatureId || value.pieceId), {
    message: "Debes enviar nomenclatureId o pieceId"
  });

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const rows = await prisma.skuNomenclature.findMany({
    orderBy: { prefix: "asc" },
    include: {
      pieces: {
        orderBy: { piece: "asc" }
      }
    }
  });

  return NextResponse.json({
    items: rows.map((row) => ({
      id: row.id,
      prefix: row.prefix,
      pieces: row.pieces.map((piece) => ({
        id: piece.id,
        piece: piece.piece
      }))
    }))
  });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  if (!canManageNomenclatures(session.user.role)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = createNomenclatureSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload invalido" }, { status: 400 });
  }

  const prefix = normalizePrefix(parsed.data.prefix);
  if (!prefix.length) {
    return NextResponse.json({ error: "La nomenclatura no es valida" }, { status: 400 });
  }

  try {
    const created = await prisma.skuNomenclature.create({
      data: { prefix }
    });

    return NextResponse.json({ id: created.id, prefix: created.prefix }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "Esa nomenclatura ya existe" }, { status: 409 });
    }
    throw error;
  }
}

export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  if (!canManageNomenclatures(session.user.role)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = addPieceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload invalido" }, { status: 400 });
  }

  const piece = normalizePiece(parsed.data.piece);
  if (!piece.length) {
    return NextResponse.json({ error: "La pieza no es valida" }, { status: 400 });
  }

  const nomenclature = await prisma.skuNomenclature.findUnique({
    where: { id: parsed.data.nomenclatureId },
    select: { id: true, prefix: true }
  });

  if (!nomenclature) {
    return NextResponse.json({ error: "Nomenclatura no encontrada" }, { status: 404 });
  }

  try {
    const created = await prisma.skuNomenclaturePiece.create({
      data: {
        nomenclatureId: nomenclature.id,
        piece
      }
    });

    return NextResponse.json(
      {
        id: created.id,
        piece: created.piece,
        nomenclatureId: nomenclature.id,
        prefix: nomenclature.prefix
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await prisma.skuNomenclaturePiece.findUnique({
        where: { piece },
        include: { nomenclature: { select: { prefix: true } } }
      });

      if (existing?.nomenclature?.prefix) {
        return NextResponse.json(
          { error: `La pieza ya esta asignada a la nomenclatura ${existing.nomenclature.prefix}` },
          { status: 409 }
        );
      }

      return NextResponse.json({ error: "La pieza ya existe" }, { status: 409 });
    }

    throw error;
  }
}

export async function DELETE(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  if (!canManageNomenclatures(session.user.role)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload invalido" }, { status: 400 });
  }

  if (parsed.data.pieceId) {
    const deleted = await prisma.skuNomenclaturePiece.deleteMany({
      where: { id: parsed.data.pieceId }
    });

    if (!deleted.count) {
      return NextResponse.json({ error: "Pieza no encontrada" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  }

  const deleted = await prisma.skuNomenclature.deleteMany({
    where: { id: parsed.data.nomenclatureId }
  });

  if (!deleted.count) {
    return NextResponse.json({ error: "Nomenclatura no encontrada" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
