export const dynamic = "force-dynamic";
export const runtime = "nodejs";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { activateItem, pauseItem } from "@/lib/mercadolibre";
import { MAX_ITEM_PHOTOS, serializeInventoryItem } from "@/lib/inventory-serialization";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 5000;

const canEditInventory = (role?: string | null) => {
  const normalized = (role ?? "").toLowerCase();
  return normalized === "admin" || normalized === "supervisor";
};

const canCreateInventory = (role?: string | null) => {
  const normalized = (role ?? "").toLowerCase();
  return normalized === "admin" || normalized === "operator" || normalized === "uploader";
};

const payloadSchema = z.object({
  skuInternal: z.string().min(1),
  title: z.string().optional(),
  price: z.number().nonnegative().optional(),
  stock: z.number().int().min(0).optional(),
  mlItemId: z.string().optional(),
  sellerCustomField: z.string().optional(),
  status: z.string().optional(),
  extraData: z.record(z.any()).optional()
});

const deleteSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
  password: z.string().min(1).optional()
});

const updateSchema = z.object({
  id: z.string().min(1),
  skuInternal: z.string().min(1).optional(),
  estatusInterno: z.string().optional().nullable(),
  status: z.enum(["active", "paused", "inactive"]).optional(),
  forceMlSync: z.boolean().optional(),
  fechaPrestamoPago: z.string().optional().nullable(),
  prestadoVendidoA: z.string().optional().nullable(),
  pieza: z.string().optional().nullable(),
  origen: z.string().optional().nullable(),
  ubicacion: z.string().optional().nullable(),
  marca: z.string().optional().nullable(),
  coche: z.string().optional().nullable(),
  anoDesde: z.string().optional().nullable(),
  anoHasta: z.string().optional().nullable(),
  photos: z.array(z.string().min(1)).max(MAX_ITEM_PHOTOS).optional(),
  stock: z.number().int().min(0).optional(),
  price: z.number().nonnegative().nullable().optional(),
  precioCompra: z.number().nonnegative().nullable().optional(),
  mlItemId: z.string().optional().nullable()
});

const clampPageSize = (value: number) => {
  if (Number.isNaN(value) || value <= 0) return DEFAULT_PAGE_SIZE;
  return Math.min(MAX_PAGE_SIZE, value);
};

const parsePagination = (searchParams: URLSearchParams) => {
  const pageParam = Number.parseInt(searchParams.get("page") ?? "1", 10);
  const pageSizeParam = Number.parseInt(searchParams.get("pageSize") ?? `${DEFAULT_PAGE_SIZE}`, 10);
  const page = Number.isNaN(pageParam) || pageParam <= 0 ? 1 : pageParam;
  const pageSize = clampPageSize(pageSizeParam);
  const skip = (page - 1) * pageSize;
  return { page, pageSize, skip };
};

const parseStatusFilter = (searchParams: URLSearchParams) => {
  const raw = (searchParams.get("statusFilter") ?? "").trim();
  if (!raw.length) return null;
  return raw.toUpperCase();
};

const parseSearchFilter = (searchParams: URLSearchParams) => {
  const raw = (searchParams.get("search") ?? "").trim();
  if (!raw.length) return null;
  return raw;
};

const buildStatusFilterSql = (statusFilter: string | null) => {
  if (!statusFilter) return Prisma.empty;
  return Prisma.sql`
    AND COALESCE(NULLIF(UPPER(TRIM("extraData"->>'estatus_interno')), ''), 'SIN ESTATUS') = ${statusFilter}
  `;
};

const buildSearchFilterSql = (searchFilter: string | null) => {
  if (!searchFilter) return Prisma.empty;
  const likeValue = `%${searchFilter}%`;
  return Prisma.sql`
    AND (
      COALESCE("skuInternal", '') ILIKE ${likeValue}
      OR COALESCE("title", '') ILIKE ${likeValue}
      OR COALESCE("mlItemId", '') ILIKE ${likeValue}
      OR COALESCE("sellerCustomField", '') ILIKE ${likeValue}
      OR COALESCE("extraData"->>'descripcion_local', '') ILIKE ${likeValue}
      OR COALESCE("extraData"->>'descripcion_ml', '') ILIKE ${likeValue}
      OR COALESCE("extraData"->>'estatus_interno', '') ILIKE ${likeValue}
      OR COALESCE("extraData"->>'origen', '') ILIKE ${likeValue}
      OR COALESCE("extraData"->>'coche', '') ILIKE ${likeValue}
      OR COALESCE("extraData"->>'pieza', '') ILIKE ${likeValue}
      OR COALESCE("extraData"->>'marca', '') ILIKE ${likeValue}
      OR COALESCE("extraData"->>'ano_desde', '') ILIKE ${likeValue}
      OR COALESCE("extraData"->>'ano_hasta', '') ILIKE ${likeValue}
      OR COALESCE("extraData"->>'ubicacion', '') ILIKE ${likeValue}
      OR COALESCE("extraData"->>'inventario', '') ILIKE ${likeValue}
      OR COALESCE("extraData"->>'revision', '') ILIKE ${likeValue}
      OR COALESCE("extraData"->>'facebook', '') ILIKE ${likeValue}
      OR COALESCE("extraData"->>'prestado_vendido_a', '') ILIKE ${likeValue}
      OR COALESCE("extraData"->>'fecha_prestamo_pago', '') ILIKE ${likeValue}
      OR CAST(COALESCE("stock", 0) AS TEXT) ILIKE ${likeValue}
      OR CAST(COALESCE("price", 0) AS TEXT) ILIKE ${likeValue}
    )
  `;
};

type InventoryIdRow = {
  id: string;
};

type CountRow = {
  count: number | bigint | string;
};

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

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const role = (session.user.role ?? "").toLowerCase();
  const ownerId = role === "viewer" ? session.user.id : null;
  const where = ownerId ? { ownerId } : undefined;

  const { searchParams } = new URL(req.url);
  const { page, pageSize, skip } = parsePagination(searchParams);
  const statusFilter = parseStatusFilter(searchParams);
  const searchFilter = parseSearchFilter(searchParams);

  if (statusFilter || searchFilter) {
    const ownerSql = ownerId ? Prisma.sql`AND "ownerId" = ${ownerId}` : Prisma.empty;
    const statusSql = buildStatusFilterSql(statusFilter);
    const searchSql = buildSearchFilterSql(searchFilter);

    const [idRows, countRows, statusTotals] = await Promise.all([
      prisma.$queryRaw<InventoryIdRow[]>(Prisma.sql`
        SELECT "id"
        FROM "InventoryItem"
        WHERE 1=1
        ${ownerSql}
        ${statusSql}
        ${searchSql}
        ORDER BY "updatedAt" DESC
        OFFSET ${skip}
        LIMIT ${pageSize}
      `),
      prisma.$queryRaw<CountRow[]>(Prisma.sql`
        SELECT COUNT(*) AS count
        FROM "InventoryItem"
        WHERE 1=1
        ${ownerSql}
        ${statusSql}
        ${searchSql}
      `),
      getStatusTotals(ownerId)
    ]);

    const ids = idRows.map((row) => row.id);
    const items = ids.length
      ? await prisma.inventoryItem.findMany({
          where: ownerId ? { ownerId, id: { in: ids } } : { id: { in: ids } },
          orderBy: { updatedAt: "desc" }
        })
      : [];

    const total = Number(countRows[0]?.count ?? 0);
    const serialized = items.map((item) => serializeInventoryItem(item));
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    return NextResponse.json({
      page,
      pageSize,
      total,
      totalPages,
      statusTotals,
      items: serialized
    });
  }

  const [items, total, statusTotals] = await Promise.all([
    prisma.inventoryItem.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip,
      take: pageSize
    }),
    prisma.inventoryItem.count({ where }),
    getStatusTotals(ownerId)
  ]);

  const serialized = items.map((item) => serializeInventoryItem(item));
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return NextResponse.json({
    page,
    pageSize,
    total,
    totalPages,
    statusTotals,
    items: serialized
  });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!canCreateInventory(session.user.role)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload invalido" }, { status: 400 });
  }

  const data = parsed.data;

  try {
    const item = await prisma.inventoryItem.create({
      data: {
        skuInternal: data.skuInternal,
        title: data.title,
        price: data.price !== undefined ? new Prisma.Decimal(data.price) : null,
        stock: data.stock ?? 0,
        mlItemId: data.mlItemId,
        sellerCustomField: data.sellerCustomField,
        status: data.status ?? undefined,
        extraData: data.extraData ?? undefined,
        ownerId: session.user.id
      }
    });

    // El fallo al escribir el log nunca debe romper la creacion del item
    try {
      await prisma.auditLog.create({
        data: {
          action: "inventory:create",
          userId: session.user.id,
          itemId: item.id,
          metadata: { skuInternal: data.skuInternal }
        }
      });
    } catch (logErr) {
      console.error("Error al crear auditLog de inventario", logErr);
    }

    return NextResponse.json(serializeInventoryItem(item, { includePhotos: true }), { status: 201 });
  } catch (err: any) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ error: "SKU interno duplicado para este usuario" }, { status: 409 });
    }

    console.error("Error al crear item de inventario", err);
    const code = (err as any)?.code;
    const message = (err as any)?.message;
    const errorMessage = code || message ? `Error al crear item (${code ?? "sin codigo"})` : "Error al crear item";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

const DELETE_PASSWORD = process.env.INVENTORY_DELETE_PASSWORD ?? process.env.DELETE_PASSWORD ?? null;

export async function DELETE(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!canEditInventory(session.user.role)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload invalido" }, { status: 400 });
  }
  const { ids, password } = parsed.data;

  if (DELETE_PASSWORD) {
    if (!password) {
      return NextResponse.json({ error: "Se requiere contraseña para borrar" }, { status: 403 });
    }
    if (password !== DELETE_PASSWORD) {
      return NextResponse.json({ error: "Contraseña incorrecta" }, { status: 403 });
    }
  }

  const result = await prisma.inventoryItem.deleteMany({
    where: { id: { in: ids } }
  });

  await prisma.auditLog.create({
    data: {
      action: "inventory:delete",
      userId: session.user.id,
      metadata: { count: result.count, ids }
    }
  });

  return NextResponse.json({ deleted: result.count });
}

export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!canEditInventory(session.user.role)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload invalido" }, { status: 400 });
  }

  const {
    id,
    skuInternal,
    estatusInterno,
    status,
    forceMlSync,
    fechaPrestamoPago,
    prestadoVendidoA,
    pieza,
    origen,
    ubicacion,
    marca,
    coche,
    anoDesde,
    anoHasta,
    photos,
    stock,
    price,
    precioCompra,
    mlItemId
  } = parsed.data;

  if (status && !["active", "paused", "inactive"].includes(status)) {
    return NextResponse.json({ error: "Estatus invalido" }, { status: 400 });
  }

  const existing = await prisma.inventoryItem.findFirst({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Item no encontrado" }, { status: 404 });
  }

  const baseExtra = typeof existing.extraData === "object" && existing.extraData !== null ? existing.extraData : {};
  const nextExtra: Record<string, any> = { ...(baseExtra as Record<string, any>) };
  if (estatusInterno !== undefined) {
    const normalizedInternalStatus = estatusInterno?.trim() ?? "";
    if (normalizedInternalStatus) {
      nextExtra.estatus_interno = normalizedInternalStatus;
    } else {
      delete nextExtra.estatus_interno;
    }
  }

  if (fechaPrestamoPago && fechaPrestamoPago.trim()) {
    nextExtra.fecha_prestamo_pago = fechaPrestamoPago.trim();
  } else if (fechaPrestamoPago === null) {
    delete nextExtra.fecha_prestamo_pago;
  }

  if (prestadoVendidoA && prestadoVendidoA.trim()) {
    nextExtra.prestado_vendido_a = prestadoVendidoA.trim();
  } else if (prestadoVendidoA === null) {
    delete nextExtra.prestado_vendido_a;
  }

  if (pieza && pieza.trim()) {
    nextExtra.pieza = pieza.trim();
  } else if (pieza === null) {
    delete nextExtra.pieza;
  }

  if (origen && origen.trim()) {
    nextExtra.origen = origen.trim();
  } else if (origen === null) {
    delete nextExtra.origen;
  }

  if (ubicacion && ubicacion.trim()) {
    nextExtra.ubicacion = ubicacion.trim();
  } else if (ubicacion === null) {
    delete nextExtra.ubicacion;
  }

  if (marca && marca.trim()) {
    nextExtra.marca = marca.trim();
  } else if (marca === null) {
    delete nextExtra.marca;
  }

  if (coche && coche.trim()) {
    nextExtra.coche = coche.trim();
  } else if (coche === null) {
    delete nextExtra.coche;
  }

  if (anoDesde && anoDesde.trim()) {
    nextExtra.ano_desde = anoDesde.trim();
  } else if (anoDesde === null) {
    delete nextExtra.ano_desde;
  }

  if (anoHasta && anoHasta.trim()) {
    nextExtra.ano_hasta = anoHasta.trim();
  } else if (anoHasta === null) {
    delete nextExtra.ano_hasta;
  }

  if (photos !== undefined) {
    const sanitized = photos
      .map((photo) => photo.trim())
      .filter((photo) => photo.length)
      .slice(0, MAX_ITEM_PHOTOS);
    if (sanitized.length) {
      nextExtra.photos = sanitized;
    } else {
      delete nextExtra.photos;
    }
  }

  if (precioCompra !== undefined) {
    if (precioCompra === null) {
      delete nextExtra.precio_compra;
    } else {
      nextExtra.precio_compra = precioCompra;
    }
  }

  let nextMlItemId: string | null | undefined = existing.mlItemId;
  if (mlItemId !== undefined) {
    if (mlItemId === null) {
      nextMlItemId = null;
    } else {
      const normalized = mlItemId.trim().toUpperCase();
      nextMlItemId = normalized.length ? normalized : null;
    }
  }

  let mlSyncError: string | null = null;
  if (
    status &&
    ["active", "paused"].includes(status) &&
    (status !== existing.status || (forceMlSync && status === "active"))
  ) {
    if (!nextMlItemId) {
      return NextResponse.json({ error: "El registro no tiene codigo de Mercado Libre" }, { status: 400 });
    }
    try {
      if (status === "paused") {
        await pauseItem(session.user.id, nextMlItemId);
      } else if (status === "active") {
        await activateItem(session.user.id, nextMlItemId);
      }
    } catch (err: any) {
      mlSyncError = err?.message || "No se pudo sincronizar con Mercado Libre";
    }
  }

  const updateData: Prisma.InventoryItemUpdateInput = {
    extraData: nextExtra,
    status: status ?? undefined,
    mlItemId: mlItemId !== undefined ? nextMlItemId : undefined
  };

  if (skuInternal !== undefined) {
    const normalizedSku = skuInternal.trim().toUpperCase();
    if (!normalizedSku) {
      return NextResponse.json({ error: "SKU invalido" }, { status: 400 });
    }
    updateData.skuInternal = normalizedSku;
  }

  if (price !== undefined) {
    updateData.price = price === null ? null : new Prisma.Decimal(price);
  }

  if (stock !== undefined) {
    updateData.stock = stock;
  }

  let item;
  try {
    item = await prisma.inventoryItem.update({
      where: { id },
      data: updateData
    });
  } catch (err: any) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ error: "SKU interno duplicado para este usuario" }, { status: 409 });
    }
    throw err;
  }

  await prisma.auditLog.create({
    data: {
      action: "inventory:update",
      userId: session.user.id,
      itemId: id,
      metadata: {
        estatusInterno: estatusInterno ?? null,
        status: status ?? null,
        fechaPrestamoPago: fechaPrestamoPago ?? null,
        prestadoVendidoA: prestadoVendidoA ?? null,
        pieza: pieza ?? null,
        origen: origen ?? null,
        ubicacion: ubicacion ?? null,
        marca: marca ?? null,
        coche: coche ?? null,
        anoDesde: anoDesde ?? null,
        anoHasta: anoHasta ?? null,
        skuInternal: skuInternal ?? null,
        stock: stock ?? null,
        price: price ?? null,
        precioCompra: precioCompra ?? null,
        mlItemId: mlItemId ?? null
      }
    }
  });

  return NextResponse.json({
    ...serializeInventoryItem(item),
    mlSyncError
  });
}
