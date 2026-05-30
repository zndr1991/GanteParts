export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { auth } from "@/lib/auth";
import { canManageFinance, formatDateOnly, getWeekRangeUtc, parseDateOnlyInput } from "@/lib/finance";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

const toAmount = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

export async function GET(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  const userRole = session?.user?.role ?? "operator";

  if (!userId) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const role = userRole.toLowerCase();
  const ownerWhere = role === "viewer" ? { ownerId: userId } : undefined;

  const { searchParams } = new URL(req.url);
  const parsedWeek = parseDateOnlyInput(searchParams.get("week"));
  const anchorDate = parsedWeek ?? new Date();
  const weekRange = getWeekRangeUtc(anchorDate);

  const [entries, debts, openingRows] = await Promise.all([
    prisma.financeEntry.findMany({
      where: {
        ...(ownerWhere ?? {}),
        entryDate: {
          gte: weekRange.start,
          lt: weekRange.endExclusive
        }
      },
      orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }]
    }),
    prisma.debt.findMany({
      where: ownerWhere,
      include: {
        movements: {
          orderBy: [{ movementDate: "desc" }, { createdAt: "desc" }]
        }
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }]
    }),
    prisma.financeEntry.groupBy({
      by: ["type"],
      where: {
        ...(ownerWhere ?? {}),
        entryDate: {
          lt: weekRange.start
        }
      },
      _sum: {
        amount: true
      }
    })
  ]);

  let incomeTotal = 0;
  let expenseTotal = 0;

  let openingIncome = 0;
  let openingExpense = 0;

  openingRows.forEach((row) => {
    const amount = toAmount(row._sum.amount);
    if (row.type === "INCOME") {
      openingIncome += amount;
      return;
    }
    openingExpense += amount;
  });

  const openingBalance = openingIncome - openingExpense;

  const serializedEntries = entries.map((entry) => {
    const amount = toAmount(entry.amount);
    const type = entry.type === "INCOME" ? "income" : "expense";
    if (type === "income") {
      incomeTotal += amount;
    } else {
      expenseTotal += amount;
    }

    return {
      id: entry.id,
      type,
      date: formatDateOnly(entry.entryDate),
      concept: entry.concept,
      code: entry.code,
      amount,
      ownerId: entry.ownerId
    };
  });

  let debtChargeTotal = 0;
  let debtPaymentTotal = 0;

  const serializedDebts = debts.map((debt) => {
    let totalCharge = 0;
    let totalPayment = 0;

    const movements = debt.movements.map((movement) => {
      const amount = toAmount(movement.amount);
      const type = movement.type === "CHARGE" ? "charge" : "payment";

      if (type === "charge") {
        totalCharge += amount;
      } else {
        totalPayment += amount;
      }

      return {
        id: movement.id,
        debtId: movement.debtId,
        type,
        concept: movement.concept,
        amount,
        date: formatDateOnly(movement.movementDate),
        createdAt: movement.createdAt.toISOString()
      };
    });

    debtChargeTotal += totalCharge;
    debtPaymentTotal += totalPayment;

    return {
      id: debt.id,
      ownerId: debt.ownerId,
      creditorName: debt.creditorName,
      concept: debt.concept,
      createdAt: debt.createdAt.toISOString(),
      totalCharge,
      totalPayment,
      balance: totalCharge - totalPayment,
      movements
    };
  });

  return NextResponse.json({
    canManage: canManageFinance(userRole),
    weekStart: formatDateOnly(weekRange.start),
    weekEnd: formatDateOnly(weekRange.endInclusive),
    entries: serializedEntries,
    totals: {
      income: incomeTotal,
      expense: expenseTotal,
      openingBalance,
      weeklyNet: incomeTotal - expenseTotal,
      balance: openingBalance + incomeTotal - expenseTotal
    },
    debts: serializedDebts,
    debtTotals: {
      charge: debtChargeTotal,
      payment: debtPaymentTotal,
      balance: debtChargeTotal - debtPaymentTotal
    }
  });
}
