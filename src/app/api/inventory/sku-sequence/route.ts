export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

const SKU_PADDING = 5;

const normalizePrefix = (value: string) =>
  value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 12);

const formatSku = (prefix: string, number: number) =>
  `${prefix}-${String(number).padStart(SKU_PADDING, "0")}`;

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const prefix = normalizePrefix(searchParams.get("prefix") ?? "");

  if (!prefix.length) {
    return NextResponse.json(
      { error: "Debes enviar un prefijo valido en el parametro prefix" },
      { status: 400 }
    );
  }

  const role = (session.user.role ?? "").toLowerCase();
  const ownerId = role === "viewer" ? session.user.id : null;
  const ownerSql = ownerId ? Prisma.sql`AND "ownerId" = ${ownerId}` : Prisma.empty;

  try {
    const regexPattern = `^${prefix}-([0-9]{1,10})$`;
    const likePattern = `${prefix}-%`;

    const rows = await prisma.$queryRaw<Array<{ last_number: number | bigint | string | null }>>(Prisma.sql`
      SELECT COALESCE(
        MAX(
          CASE
            WHEN substring(UPPER("skuInternal") FROM ${regexPattern}) IS NOT NULL
              THEN substring(UPPER("skuInternal") FROM ${regexPattern})::BIGINT
            ELSE NULL
          END
        ),
        0
      ) AS last_number
      FROM "InventoryItem"
      WHERE UPPER("skuInternal") LIKE ${likePattern}
      ${ownerSql}
    `);

    const lastNumberRaw = Number(rows[0]?.last_number ?? 0);
    const lastNumber = Number.isFinite(lastNumberRaw) && lastNumberRaw > 0 ? Math.trunc(lastNumberRaw) : 0;
    const nextNumber = lastNumber + 1;

    return NextResponse.json({
      prefix,
      nextNumber,
      sku: formatSku(prefix, nextNumber),
      padding: SKU_PADDING
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2024") {
      return NextResponse.json(
        { error: "El servidor esta ocupado. Intenta de nuevo en unos segundos." },
        { status: 503 }
      );
    }
    throw error;
  }
}
