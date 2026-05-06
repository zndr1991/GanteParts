export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { INVENTORY_LIST_SELECT, serializeInventoryItem } from "@/lib/inventory-serialization";
import { Prisma } from "@prisma/client";

const DEFAULT_FULL_LOAD_LIMIT = 0;
const FULL_LOAD_LIMIT_ENV = Number(
  process.env.INVENTORY_BULK_LOAD_LIMIT ?? process.env.INVENTORY_FULL_LOAD_LIMIT ?? `${DEFAULT_FULL_LOAD_LIMIT}`
);
const FULL_LOAD_LIMIT =
  Number.isFinite(FULL_LOAD_LIMIT_ENV) && FULL_LOAD_LIMIT_ENV > 0
    ? Math.floor(FULL_LOAD_LIMIT_ENV)
    : DEFAULT_FULL_LOAD_LIMIT;

type StatusCountRow = {
  label: string | null;
  count: number | bigint | string;
};

const getStatusTotals = async (ownerId: string | null) => {
  const whereSql = ownerId ? Prisma.sql`WHERE "ownerId" = ${ownerId}` : Prisma.empty;
  const rows = await prisma.$queryRaw<StatusCountRow[]>(Prisma.sql`
    SELECT
      COALESCE(NULLIF(UPPER(TRIM("extraData"->>'estatus_interno')), ''), 'SIN ESTATUS') AS label,
      COUNT(*) AS count
    FROM "InventoryItem"
    ${whereSql}
    GROUP BY 1
  `);

  const totals: Record<string, number> = {};
  rows.forEach((row) => {
    const key = (row.label ?? "").toString().trim().toUpperCase() || "SIN ESTATUS";
    const parsedCount = Number(row.count ?? 0);
    if (!Number.isFinite(parsedCount) || parsedCount <= 0) return;
    totals[key] = Math.round(parsedCount);
  });

  return totals;
};

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const role = (session.user.role ?? "").toLowerCase();
  const where = role === "viewer" ? { ownerId: session.user.id } : undefined;
  const ownerId = role === "viewer" ? session.user.id : null;

  const [total, statusTotals] = await Promise.all([
    prisma.inventoryItem.count({ where }),
    getStatusTotals(ownerId)
  ]);
  if (total === 0) {
    return NextResponse.json({ total: 0, statusTotals: {}, items: [] });
  }

  const shouldTruncate = FULL_LOAD_LIMIT > 0 && total > FULL_LOAD_LIMIT;
  const take = shouldTruncate ? FULL_LOAD_LIMIT : total;

  const items = await prisma.inventoryItem.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take,
    select: INVENTORY_LIST_SELECT
  });

  return NextResponse.json({
    total,
    statusTotals,
    items: items.map((item) => serializeInventoryItem(item)),
    truncated: shouldTruncate
  });
}
