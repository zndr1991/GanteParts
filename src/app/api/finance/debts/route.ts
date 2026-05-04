export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { auth } from "@/lib/auth";
import { canManageFinance } from "@/lib/finance";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

const debtSchema = z.object({
  creditorName: z.string().min(1).max(120),
  concept: z.string().min(1).max(180),
  amount: z.coerce.number().positive(),
  date: z.string().optional().nullable()
});

const deleteSchema = z.object({
  id: z.string().min(1)
});

const parseDateOnlyInput = (value: unknown) => {
  const raw = (value ?? "").toString().trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() + 1 !== month ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }

  return parsed;
};

export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  const userRole = session?.user?.role ?? "operator";

  if (!userId) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  if (!canManageFinance(userRole)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = debtSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload invalido" }, { status: 400 });
  }

  const creditorName = parsed.data.creditorName.trim();
  const concept = parsed.data.concept.trim();
  if (!creditorName.length || !concept.length) {
    return NextResponse.json({ error: "Acreedor y concepto son obligatorios" }, { status: 400 });
  }

  const movementDate = parsed.data.date ? parseDateOnlyInput(parsed.data.date) : new Date();
  if (!movementDate) {
    return NextResponse.json({ error: "Fecha invalida" }, { status: 400 });
  }

  const created = await prisma.$transaction(async (tx) => {
    const debt = await tx.debt.create({
      data: {
        ownerId: userId,
        creditorName,
        concept
      }
    });

    await tx.debtMovement.create({
      data: {
        debtId: debt.id,
        type: "CHARGE",
        concept,
        amount: new Prisma.Decimal(parsed.data.amount),
        movementDate
      }
    });

    return debt;
  });

  return NextResponse.json({ id: created.id }, { status: 201 });
}

export async function DELETE(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  const userRole = session?.user?.role ?? "operator";

  if (!userId) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  if (!canManageFinance(userRole)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload invalido" }, { status: 400 });
  }

  const deleted = await prisma.debt.deleteMany({
    where: {
      id: parsed.data.id
    }
  });

  if (!deleted.count) {
    return NextResponse.json({ error: "Deuda no encontrada" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
