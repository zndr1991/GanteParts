export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { auth } from "@/lib/auth";
import { canManageFinance, parseDateOnlyInput } from "@/lib/finance";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

const movementSchema = z.object({
  debtId: z.string().min(1),
  type: z.enum(["charge", "payment"]),
  concept: z.string().min(1).max(180),
  amount: z.coerce.number().positive(),
  date: z.string().optional().nullable()
});

const deleteSchema = z.object({
  id: z.string().min(1)
});

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
  const parsed = movementSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload invalido" }, { status: 400 });
  }

  const concept = parsed.data.concept.trim();
  if (!concept.length) {
    return NextResponse.json({ error: "Concepto obligatorio" }, { status: 400 });
  }

  const movementDate = parsed.data.date ? parseDateOnlyInput(parsed.data.date) : new Date();
  if (!movementDate) {
    return NextResponse.json({ error: "Fecha invalida" }, { status: 400 });
  }

  const debt = await prisma.debt.findUnique({
    where: { id: parsed.data.debtId },
    select: { id: true, concept: true }
  });

  if (!debt) {
    return NextResponse.json({ error: "Deuda no encontrada" }, { status: 404 });
  }

  const created = await prisma.$transaction(async (tx) => {
    const movement = await tx.debtMovement.create({
      data: {
        debtId: debt.id,
        type: parsed.data.type === "charge" ? "CHARGE" : "PAYMENT",
        concept,
        amount: new Prisma.Decimal(parsed.data.amount),
        movementDate
      }
    });

    await tx.debt.update({
      where: { id: debt.id },
      data: { concept: debt.concept }
    });

    return movement;
  });

  return NextResponse.json(
    {
      id: created.id,
      debtId: created.debtId,
      type: created.type === "CHARGE" ? "charge" : "payment",
      concept: created.concept,
      amount: Number(created.amount),
      date: created.movementDate.toISOString().slice(0, 10)
    },
    { status: 201 }
  );
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

  const movement = await prisma.debtMovement.findUnique({
    where: { id: parsed.data.id },
    select: { id: true, debtId: true }
  });

  if (!movement) {
    return NextResponse.json({ error: "Movimiento no encontrado" }, { status: 404 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.debtMovement.delete({ where: { id: movement.id } });

    const debt = await tx.debt.findUnique({
      where: { id: movement.debtId },
      select: { id: true, concept: true }
    });

    if (debt) {
      await tx.debt.update({
        where: { id: debt.id },
        data: { concept: debt.concept }
      });
    }
  });

  return NextResponse.json({ ok: true });
}
