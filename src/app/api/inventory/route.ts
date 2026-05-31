export const dynamic = "force-dynamic";
export const runtime = "nodejs";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { activateItem, pauseItem } from "@/lib/mercadolibre";
import { MAX_ITEM_PHOTOS, serializeInventoryItem } from "@/lib/inventory-serialization";
import { Prisma } from "@prisma/client";
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 5000;
const STATUS_TOTALS_CACHE_TTL_MS = 5 * 60 * 1000;

const canEditInventory = (role?: string | null) => {
  const normalized = (role ?? "").toLowerCase();
  return normalized === "admin" || normalized === "supervisor";
};

const canCreateInventory = (role?: string | null) => {
  const normalized = (role ?? "").toLowerCase();
  return normalized === "admin" || normalized === "operator" || normalized === "uploader";
};

const revalidateInventorySnapshotCache = () => {
  revalidateTag("inventory-initial");
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

const normalizeSearchToken = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

const isLikelyCodeSearch = (rawValue: string, normalizedToken: string) => {
  if (normalizedToken.length < 3) return false;
  if (rawValue.length > 48) return false;
  if (/\s/.test(rawValue)) return false;
  return /[0-9]/.test(rawValue) && /[a-z]/i.test(rawValue);
};

const parseFacetFilter = (searchParams: URLSearchParams, key: "marcaFilter" | "cocheFilter" | "piezaFilter") => {
  const raw = (searchParams.get(key) ?? "").trim();
  if (!raw.length) return null;
  return raw.toUpperCase();
};

const parsePrestadoDebtorFilters = (searchParams: URLSearchParams) => {
  const values = searchParams
    .getAll("prestadoDebtorFilter")
    .map((entry) => entry.trim().toUpperCase())
    .filter((entry) => entry.length);

  return Array.from(new Set(values));
};

const parseIncludeFacetOptions = (searchParams: URLSearchParams) => {
  const raw = (searchParams.get("includeFacetOptions") ?? "").trim().toLowerCase();
  if (!raw.length) return true;
  return raw === "1" || raw === "true" || raw === "yes";
};

const buildStatusFilterSql = (statusFilter: string | null) => {
  if (!statusFilter) return Prisma.empty;
  return Prisma.sql`
    AND COALESCE(NULLIF(UPPER(TRIM("extraData"->>'estatus_interno')), ''), 'SIN ESTATUS') = ${statusFilter}
  `;
};

const buildSearchFilterSql = (searchFilter: string | null) => {
  if (!searchFilter) return Prisma.empty;
  const normalizedToken = normalizeSearchToken(searchFilter);
  const likeValue = `%${searchFilter}%`;

  if (isLikelyCodeSearch(searchFilter, normalizedToken)) {
    const normalizedPrefixValue = `${normalizedToken}%`;
    return Prisma.sql`
      AND (
        replace(replace(replace(lower(coalesce("skuInternal", '')), '-', ''), ' ', ''), '_', '') LIKE ${normalizedPrefixValue}
        OR replace(replace(replace(lower(coalesce("mlItemId", '')), '-', ''), ' ', ''), '_', '') LIKE ${normalizedPrefixValue}
        OR replace(replace(replace(lower(coalesce("sellerCustomField", '')), '-', ''), ' ', ''), '_', '') LIKE ${normalizedPrefixValue}
      )
    `;
  }

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

const buildMarcaFilterSql = (marcaFilter: string | null) => {
  if (!marcaFilter) return Prisma.empty;
  return Prisma.sql`
    AND COALESCE(NULLIF(UPPER(TRIM("extraData"->>'marca')), ''), '') = ${marcaFilter}
  `;
};

const buildCocheFilterSql = (cocheFilter: string | null) => {
  if (!cocheFilter) return Prisma.empty;
  return Prisma.sql`
    AND COALESCE(NULLIF(UPPER(TRIM("extraData"->>'coche')), ''), '') = ${cocheFilter}
  `;
};

const buildPiezaFilterSql = (piezaFilter: string | null) => {
  if (!piezaFilter) return Prisma.empty;
  return Prisma.sql`
    AND COALESCE(
      NULLIF(UPPER(TRIM("extraData"->>'pieza')), ''),
      UPPER(TRIM(COALESCE("title", '')))
    ) = ${piezaFilter}
  `;
};

const buildPrestadoDebtorFilterSql = (prestadoDebtorFilters: string[]) => {
  if (!prestadoDebtorFilters.length) return Prisma.empty;
  return Prisma.sql`
    AND COALESCE(NULLIF(UPPER(TRIM("extraData"->>'prestado_vendido_a')), ''), '') IN (${Prisma.join(prestadoDebtorFilters)})
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

type PrestadoMetricsRow = {
  total_value: number | bigint | string | null;
  total_cost: number | bigint | string | null;
};

type PrestadoMetrics = {
  total: number;
  debt: number;
  profit: number;
};

type InventoryFacetOptions = {
  marca: string[];
  coche: string[];
  pieza: string[];
  prestadoDebtor: string[];
};

type FacetValueRow = {
  value: string | null;
};

type StatusTotalsCacheEntry = {
  value: Record<string, number>;
  expiresAt: number;
};

const statusTotalsCache = new Map<string, StatusTotalsCacheEntry>();
const statusTotalsInFlight = new Map<string, Promise<Record<string, number>>>();

const statusTotalsCacheKey = (ownerId: string | null) => ownerId ?? "__ALL__";

const invalidateStatusTotalsCache = () => {
  statusTotalsCache.clear();
  statusTotalsInFlight.clear();
};

const roundCurrencyValue = (value: number) => Math.round(value * 100) / 100;

const FACET_MARCA_SQL = Prisma.sql`COALESCE(NULLIF(UPPER(TRIM("extraData"->>'marca')), ''), '')`;
const FACET_COCHE_SQL = Prisma.sql`COALESCE(NULLIF(UPPER(TRIM("extraData"->>'coche')), ''), '')`;
const FACET_PIEZA_SQL = Prisma.sql`
  COALESCE(
    NULLIF(UPPER(TRIM("extraData"->>'pieza')), ''),
    UPPER(TRIM(COALESCE("title", ''))),
    ''
  )
`;
const FACET_PRESTADO_DEBTOR_SQL = Prisma.sql`COALESCE(NULLIF(UPPER(TRIM("extraData"->>'prestado_vendido_a')), ''), '')`;

const normalizeFacetValues = (rows: FacetValueRow[]) => {
  const set = new Set<string>();
  rows.forEach((row) => {
    const value = (row.value ?? "").toString().trim().toUpperCase();
    if (!value.length) return;
    set.add(value);
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b, "es"));
};

const queryDistinctFacetValues = async (params: {
  facetSql: Prisma.Sql;
  ownerSql: Prisma.Sql;
  statusSql: Prisma.Sql;
  searchSql: Prisma.Sql;
  marcaSql?: Prisma.Sql;
  cocheSql?: Prisma.Sql;
  piezaSql?: Prisma.Sql;
  prestadoDebtorSql?: Prisma.Sql;
}) => {
  const rows = await prisma.$queryRaw<FacetValueRow[]>(Prisma.sql`
    SELECT DISTINCT facet_value AS value
    FROM (
      SELECT ${params.facetSql} AS facet_value
      FROM "InventoryItem"
      WHERE 1=1
      ${params.ownerSql}
      ${params.statusSql}
      ${params.searchSql}
      ${params.marcaSql ?? Prisma.empty}
      ${params.cocheSql ?? Prisma.empty}
      ${params.piezaSql ?? Prisma.empty}
      ${params.prestadoDebtorSql ?? Prisma.empty}
    ) AS facets
    WHERE facet_value IS NOT NULL
      AND facet_value <> ''
    ORDER BY facet_value ASC
  `);

  return normalizeFacetValues(rows);
};

const getInventoryFacetOptions = async (params: {
  ownerSql: Prisma.Sql;
  statusSql: Prisma.Sql;
  searchSql: Prisma.Sql;
  marcaSql: Prisma.Sql;
  cocheSql: Prisma.Sql;
  piezaSql: Prisma.Sql;
  prestadoDebtorSql: Prisma.Sql;
  statusFilter: string | null;
}): Promise<InventoryFacetOptions> => {
  const [marca, coche, pieza, prestadoDebtor] = await Promise.all([
    queryDistinctFacetValues({
      facetSql: FACET_MARCA_SQL,
      ownerSql: params.ownerSql,
      statusSql: params.statusSql,
      searchSql: params.searchSql,
      cocheSql: params.cocheSql,
      piezaSql: params.piezaSql,
      prestadoDebtorSql: params.prestadoDebtorSql
    }),
    queryDistinctFacetValues({
      facetSql: FACET_COCHE_SQL,
      ownerSql: params.ownerSql,
      statusSql: params.statusSql,
      searchSql: params.searchSql,
      marcaSql: params.marcaSql,
      piezaSql: params.piezaSql,
      prestadoDebtorSql: params.prestadoDebtorSql
    }),
    queryDistinctFacetValues({
      facetSql: FACET_PIEZA_SQL,
      ownerSql: params.ownerSql,
      statusSql: params.statusSql,
      searchSql: params.searchSql,
      marcaSql: params.marcaSql,
      cocheSql: params.cocheSql,
      prestadoDebtorSql: params.prestadoDebtorSql
    }),
    params.statusFilter === "PRESTADO"
      ? queryDistinctFacetValues({
          facetSql: FACET_PRESTADO_DEBTOR_SQL,
          ownerSql: params.ownerSql,
          statusSql: params.statusSql,
          searchSql: params.searchSql,
          marcaSql: params.marcaSql,
          cocheSql: params.cocheSql,
          piezaSql: params.piezaSql
        })
      : Promise.resolve<string[]>([])
  ]);

  return {
    marca,
    coche,
    pieza,
    prestadoDebtor
  };
};

const parseNumericValue = (value: number | bigint | string | null | undefined) => {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return parsed;
};

const getPrestadoMetrics = async (params: {
  ownerSql: Prisma.Sql;
  statusSql: Prisma.Sql;
  searchSql: Prisma.Sql;
  marcaSql: Prisma.Sql;
  cocheSql: Prisma.Sql;
  piezaSql: Prisma.Sql;
  prestadoDebtorSql: Prisma.Sql;
}): Promise<PrestadoMetrics> => {
  const rows = await prisma.$queryRaw<PrestadoMetricsRow[]>(Prisma.sql`
    SELECT
      COALESCE(
        SUM(
          COALESCE("price", 0) *
          CASE WHEN COALESCE("stock", 0) > 0 THEN COALESCE("stock", 0) ELSE 1 END
        ),
        0
      ) AS total_value,
      COALESCE(
        SUM(
          (
            CASE
              WHEN jsonb_typeof("extraData"->'precio_compra') = 'number' THEN ("extraData"->>'precio_compra')::numeric
              WHEN regexp_replace(COALESCE("extraData"->>'precio_compra', ''), '[^0-9\\.-]+', '', 'g') ~ '^-?[0-9]+(\\.[0-9]+)?$'
                THEN regexp_replace(COALESCE("extraData"->>'precio_compra', ''), '[^0-9\\.-]+', '', 'g')::numeric
              ELSE 0
            END
          ) * CASE WHEN COALESCE("stock", 0) > 0 THEN COALESCE("stock", 0) ELSE 1 END
        ),
        0
      ) AS total_cost
    FROM "InventoryItem"
    WHERE 1=1
    ${params.ownerSql}
    ${params.statusSql}
    ${params.searchSql}
    ${params.marcaSql}
    ${params.cocheSql}
    ${params.piezaSql}
    ${params.prestadoDebtorSql}
  `);

  const total = roundCurrencyValue(parseNumericValue(rows[0]?.total_value));
  const cost = roundCurrencyValue(parseNumericValue(rows[0]?.total_cost));
  const profit = roundCurrencyValue(total - cost);

  return {
    total,
    debt: total,
    profit
  };
};

const queryStatusTotals = async (ownerId: string | null) => {
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

const getStatusTotals = async (ownerId: string | null) => {
  const key = statusTotalsCacheKey(ownerId);
  const now = Date.now();
  const cached = statusTotalsCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const inflight = statusTotalsInFlight.get(key);
  if (inflight) {
    return inflight;
  }

  const task = queryStatusTotals(ownerId)
    .then((value) => {
      statusTotalsCache.set(key, {
        value,
        expiresAt: Date.now() + STATUS_TOTALS_CACHE_TTL_MS
      });
      return value;
    })
    .finally(() => {
      statusTotalsInFlight.delete(key);
    });

  statusTotalsInFlight.set(key, task);
  return task;
};

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const role = (session.user.role ?? "").toLowerCase();
  const ownerId = role === "viewer" ? session.user.id : null;
  const where = ownerId ? { ownerId } : undefined;

  try {
    const { searchParams } = new URL(req.url);
    const { page, pageSize, skip } = parsePagination(searchParams);
    const statusFilter = parseStatusFilter(searchParams);
    const searchFilter = parseSearchFilter(searchParams);
    const marcaFilter = parseFacetFilter(searchParams, "marcaFilter");
    const cocheFilter = parseFacetFilter(searchParams, "cocheFilter");
    const piezaFilter = parseFacetFilter(searchParams, "piezaFilter");
    const prestadoDebtorFilters = parsePrestadoDebtorFilters(searchParams);
    const includeFacetOptions = parseIncludeFacetOptions(searchParams);

    const ownerSql = ownerId ? Prisma.sql`AND "ownerId" = ${ownerId}` : Prisma.empty;
    const statusSql = buildStatusFilterSql(statusFilter);
    const searchSql = buildSearchFilterSql(searchFilter);
    const marcaSql = buildMarcaFilterSql(marcaFilter);
    const cocheSql = buildCocheFilterSql(cocheFilter);
    const piezaSql = buildPiezaFilterSql(piezaFilter);
    const prestadoDebtorSql = buildPrestadoDebtorFilterSql(prestadoDebtorFilters);

    if (statusFilter || searchFilter || marcaFilter || cocheFilter || piezaFilter || prestadoDebtorFilters.length) {
      const normalizedSearchToken = searchFilter ? normalizeSearchToken(searchFilter) : "";
      const codeSearchMode = Boolean(searchFilter && isLikelyCodeSearch(searchFilter, normalizedSearchToken));
      const fastCodeSearchMode =
        codeSearchMode && !statusFilter && !marcaFilter && !cocheFilter && !piezaFilter && !prestadoDebtorFilters.length && page === 1;
      const shouldLoadPrestadoMetrics = statusFilter === "PRESTADO";

      const [idRows, countRows, statusTotals, prestadoMetrics, facetOptions] = await Promise.all([
        prisma.$queryRaw<InventoryIdRow[]>(Prisma.sql`
          SELECT "id"
          FROM "InventoryItem"
          WHERE 1=1
          ${ownerSql}
          ${statusSql}
          ${searchSql}
          ${marcaSql}
          ${cocheSql}
          ${piezaSql}
          ${prestadoDebtorSql}
          ORDER BY "updatedAt" DESC
          OFFSET ${skip}
          LIMIT ${fastCodeSearchMode ? pageSize + 1 : pageSize}
        `),
        fastCodeSearchMode
          ? Promise.resolve<CountRow[]>([])
          : prisma.$queryRaw<CountRow[]>(Prisma.sql`
              SELECT COUNT(*) AS count
              FROM "InventoryItem"
              WHERE 1=1
              ${ownerSql}
              ${statusSql}
              ${searchSql}
              ${marcaSql}
              ${cocheSql}
              ${piezaSql}
              ${prestadoDebtorSql}
            `),
        getStatusTotals(ownerId),
        shouldLoadPrestadoMetrics
          ? getPrestadoMetrics({ ownerSql, statusSql, searchSql, marcaSql, cocheSql, piezaSql, prestadoDebtorSql })
          : Promise.resolve<PrestadoMetrics | null>(null),
        includeFacetOptions
          ? getInventoryFacetOptions({
              ownerSql,
              statusSql,
              searchSql,
              marcaSql,
              cocheSql,
              piezaSql,
              prestadoDebtorSql,
              statusFilter
            })
          : Promise.resolve<InventoryFacetOptions | null>(null)
      ]);

      const hasMoreFastRows = fastCodeSearchMode && idRows.length > pageSize;
      const ids = (hasMoreFastRows ? idRows.slice(0, pageSize) : idRows).map((row) => row.id);
      const items = ids.length
        ? await prisma.inventoryItem.findMany({
            where: ownerId ? { ownerId, id: { in: ids } } : { id: { in: ids } },
            orderBy: { updatedAt: "desc" }
          })
        : [];

      const total = fastCodeSearchMode
        ? hasMoreFastRows
          ? pageSize + 1
          : ids.length
        : Number(countRows[0]?.count ?? 0);
      const serialized = items.map((item) => serializeInventoryItem(item));
      const totalPages = Math.max(1, Math.ceil(total / pageSize));

      return NextResponse.json({
        page,
        pageSize,
        total,
        totalPages,
        statusTotals,
        prestadoMetrics,
        facetOptions: includeFacetOptions ? facetOptions : undefined,
        items: serialized
      });
    }

    const [items, total, statusTotals, facetOptions] = await Promise.all([
      prisma.inventoryItem.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip,
        take: pageSize
      }),
      prisma.inventoryItem.count({ where }),
      getStatusTotals(ownerId),
      includeFacetOptions
        ? getInventoryFacetOptions({
            ownerSql,
            statusSql,
            searchSql,
            marcaSql,
            cocheSql,
            piezaSql,
            prestadoDebtorSql,
            statusFilter
          })
        : Promise.resolve<InventoryFacetOptions | null>(null)
    ]);

    const serialized = items.map((item) => serializeInventoryItem(item));
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    return NextResponse.json({
      page,
      pageSize,
      total,
      totalPages,
      statusTotals,
      facetOptions: includeFacetOptions ? facetOptions : undefined,
      items: serialized
    });
  } catch (err: any) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2024") {
      return NextResponse.json(
        { error: "El servidor esta ocupado. Intenta de nuevo en unos segundos." },
        { status: 503 }
      );
    }
    throw err;
  }
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

    revalidateInventorySnapshotCache();
    invalidateStatusTotalsCache();

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

  revalidateInventorySnapshotCache();
  invalidateStatusTotalsCache();

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

  revalidateInventorySnapshotCache();
  invalidateStatusTotalsCache();

  return NextResponse.json({
    ...serializeInventoryItem(item),
    mlSyncError
  });
}
