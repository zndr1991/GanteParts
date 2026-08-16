export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { serializeInventoryItem } from "@/lib/inventory-serialization";
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

type InventoryListRow = {
  id: string;
  skuInternal: string;
  sellerCustomField: string | null;
  title: string | null;
  price: any;
  stock: number | bigint;
  status: string;
  mlItemId: string | null;
  extraData: any;
  photoCount: number | bigint;
  createdAt: Date;
  updatedAt: Date;
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

  const total = await prisma.inventoryItem.count({ where });
  const statusTotals = await getStatusTotals(ownerId);
  if (total === 0) {
    return NextResponse.json({ total: 0, statusTotals: {}, items: [], skippedCount: 0, truncated: false });
  }

  const shouldTruncate = FULL_LOAD_LIMIT > 0 && total > FULL_LOAD_LIMIT;
  const ownerSql = ownerId ? Prisma.sql`AND "ownerId" = ${ownerId}` : Prisma.empty;
  const limitSql = shouldTruncate ? Prisma.sql`LIMIT ${FULL_LOAD_LIMIT}` : Prisma.empty;

  const rows = await prisma.$queryRaw<InventoryListRow[]>(Prisma.sql`
    SELECT
      "id", "skuInternal", "sellerCustomField", "title", "price", "stock",
      "status", "mlItemId",
      ("extraData" - 'photos') AS "extraData",
      COALESCE(
        CASE
          WHEN jsonb_typeof("extraData"->'photos') = 'array' THEN jsonb_array_length("extraData"->'photos')
          ELSE 0
        END,
        0
      )::int AS "photoCount",
      "createdAt", "updatedAt"
    FROM "InventoryItem"
    WHERE 1=1
    ${ownerSql}
    ORDER BY "updatedAt" DESC
    ${limitSql}
  `);

  const serialized = rows.map((rawRow) => {
    const result = serializeInventoryItem(rawRow);
    result.photoCount = Number(rawRow.photoCount ?? 0);
    return result;
  });

  return NextResponse.json({
    total,
    statusTotals,
    items: serialized,
    skippedCount: 0,
    truncated: shouldTruncate
  });
}
