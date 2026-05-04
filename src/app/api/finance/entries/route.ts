export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { auth } from "@/lib/auth";
import { canManageFinance, formatDateOnly, parseDateOnlyInput } from "@/lib/finance";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

const entrySchema = z.object({
  type: z.enum(["income", "expense"]),
  date: z.string().min(1),
  concept: z.string().min(1).max(180),
  code: z.string().max(80).optional().nullable(),
  amount: z.coerce.number().positive()
});

const deleteSchema = z.object({
  id: z.string().min(1)
});

const toAmount = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
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
  const parsed = entrySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload invalido" }, { status: 400 });
  }

  const concept = parsed.data.concept.trim();
  if (!concept.length) {
    return NextResponse.json({ error: "Concepto obligatorio" }, { status: 400 });
  }

  const date = parseDateOnlyInput(parsed.data.date);
  if (!date) {
    return NextResponse.json({ error: "Fecha invalida" }, { status: 400 });
  }

  const created = await prisma.financeEntry.create({
    data: {
      ownerId: userId,
      type: parsed.data.type === "income" ? "INCOME" : "EXPENSE",
      entryDate: date,
      concept,
      code: parsed.data.code?.toString().trim() || null,
      amount: new Prisma.Decimal(parsed.data.amount)
    }
  });

  return NextResponse.json(
    {
      id: created.id,
      type: created.type === "INCOME" ? "income" : "expense",
      date: formatDateOnly(created.entryDate),
      concept: created.concept,
      code: created.code,
      amount: toAmount(created.amount)
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

  const deleted = await prisma.financeEntry.deleteMany({
    where: {
      id: parsed.data.id
    }
  });

  if (!deleted.count) {
    return NextResponse.json({ error: "Registro no encontrado" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
