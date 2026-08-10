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
const MAX_SEARCH_TOKENS = 4;

const canEditInventory = (role?: string | null) => {
  const normalized = (role ?? "").toLowerCase();
  return normalized === "admin" || normalized === "supervisor";
};

const canCreateInventory = (role?: string | null) => {
  const normalized = (role ?? "").toLowerCase();
  return normalized === "admin" || normalized === "operator" || normalized === "uploader";
};

const GLOBAL_DUPLICATE_SKU_ERROR = "SKU interno ya existe en la base de datos";

const normalizeSkuInternal = (value: string) => value.trim().toUpperCase();

const findInventoryItemBySkuGlobal = async (normalizedSku: string, excludeId?: string) => {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "InventoryItem"
    WHERE UPPER(TRIM(COALESCE("skuInternal", ''))) = ${normalizedSku}
    ${excludeId ? Prisma.sql`AND "id" <> ${excludeId}` : Prisma.empty}
    LIMIT 1
  `);
  return rows[0] ?? null;
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

const formaPublicacionSchema = z.union([z.literal("envio gratis"), z.literal("sin envio gratis")]);

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
  version: z.string().optional().nullable(),
  anoDesde: z.string().optional().nullable(),
  anoHasta: z.string().optional().nullable(),
  alto: z.string().optional().nullable(),
  largo: z.string().optional().nullable(),
  ancho: z.string().optional().nullable(),
  peso: z.string().optional().nullable(),
  formaPublicacion: z.preprocess(
    (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
    formaPublicacionSchema.optional().nullable()
  ),
  observaciones: z.string().optional().nullable(),
  compatibilidades: z.string().optional().nullable(),
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
  if (!splitSearchTokens(raw).length) return null;
  return raw;
};

const splitSearchTokens = (value: string) => {
  const tokens = value
    .toLowerCase()
    .split(/[\s,.;:/|\\_-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length);

  return Array.from(new Set(tokens)).slice(0, MAX_SEARCH_TOKENS);
};

const parseSearchYearToken = (token: string) => {
  if (!/^\d{4}$/.test(token)) return null;
  const year = Number.parseInt(token, 10);
  if (!Number.isFinite(year) || year < 1900 || year > 2100) return null;
  return year;
};

const normalizeSearchToken = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

const isLikelyCodeSearch = (rawValue: string, normalizedToken: string) => {
  if (normalizedToken.length < 3) return false;
  const compactRawValue = rawValue.replace(/[\s._-]+/g, "");
  if (compactRawValue.length > 48) return false;
  const wordCount = rawValue.trim().split(/\s+/).filter((token) => token.length).length;
  if (wordCount !== 1) return false;
  return /[0-9]/.test(normalizedToken) && /[a-z]/i.test(normalizedToken);
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

const parseIncludeMeta = (searchParams: URLSearchParams) => {
  const raw = (searchParams.get("includeMeta") ?? "").trim().toLowerCase();
  if (!raw.length) return true;
  return raw === "1" || raw === "true" || raw === "yes";
};

// Debe mantenerse alineado con el índice trigram InventoryItem_search_document_trgm_idx.
const SEARCH_DOCUMENT_SQL = Prisma.sql`
  lower(
    COALESCE("skuInternal", '') || ' ' ||
    COALESCE("title", '') || ' ' ||
    COALESCE("mlItemId", '') || ' ' ||
    COALESCE("sellerCustomField", '') || ' ' ||
    COALESCE("extraData"->>'descripcion_local', '') || ' ' ||
    COALESCE("extraData"->>'descripcion_ml', '') || ' ' ||
    COALESCE("extraData"->>'estatus_interno', '') || ' ' ||
    COALESCE("extraData"->>'origen', '') || ' ' ||
    COALESCE("extraData"->>'coche', '') || ' ' ||
    COALESCE("extraData"->>'pieza', '') || ' ' ||
    COALESCE("extraData"->>'marca', '') || ' ' ||
    COALESCE("extraData"->>'ano_desde', '') || ' ' ||
    COALESCE("extraData"->>'ano_hasta', '') || ' ' ||
    COALESCE("extraData"->>'ubicacion', '') || ' ' ||
    COALESCE("extraData"->>'inventario', '') || ' ' ||
    COALESCE("extraData"->>'revision', '') || ' ' ||
    COALESCE("extraData"->>'facebook', '') || ' ' ||
    COALESCE("extraData"->>'prestado_vendido_a', '') || ' ' ||
    COALESCE("extraData"->>'fecha_prestamo_pago', '') || ' ' ||
    CAST(COALESCE("stock", 0) AS TEXT) || ' ' ||
    CAST(COALESCE("price", 0) AS TEXT)
  )
`;

const YEAR_FROM_SQL = Prisma.sql`
  CASE
    WHEN regexp_replace(COALESCE("extraData"->>'ano_desde', ''), '[^0-9]+', '', 'g') ~ '^[0-9]{4}$'
      THEN regexp_replace(COALESCE("extraData"->>'ano_desde', ''), '[^0-9]+', '', 'g')::int
    ELSE NULL
  END
`;

const YEAR_TO_SQL = Prisma.sql`
  CASE
    WHEN regexp_replace(COALESCE("extraData"->>'ano_hasta', ''), '[^0-9]+', '', 'g') ~ '^[0-9]{4}$'
      THEN regexp_replace(COALESCE("extraData"->>'ano_hasta', ''), '[^0-9]+', '', 'g')::int
    ELSE NULL
  END
`;

const buildYearTokenSql = (year: number) => {
  const normalizedFromSql = Prisma.sql`COALESCE(${YEAR_FROM_SQL}, ${YEAR_TO_SQL})`;
  const normalizedToSql = Prisma.sql`COALESCE(${YEAR_TO_SQL}, ${YEAR_FROM_SQL})`;

  return Prisma.sql`
    OR (
      ${normalizedFromSql} IS NOT NULL
      AND ${normalizedToSql} IS NOT NULL
      AND ${year} BETWEEN LEAST(${normalizedFromSql}, ${normalizedToSql}) AND GREATEST(${normalizedFromSql}, ${normalizedToSql})
    )
  `;
};

const buildStatusFilterSql = (statusFilter: string | null) => {
  if (!statusFilter) return Prisma.empty;
  return Prisma.sql`
    AND COALESCE(NULLIF(UPPER(TRIM("extraData"->>'estatus_interno')), ''), 'SIN ESTATUS') = ${statusFilter}
  `;
};

const NORMALIZED_SKU_SQL = Prisma.sql`replace(replace(replace(lower(coalesce("skuInternal", '')), '-', ''), ' ', ''), '_', '')`;
const NORMALIZED_ML_SQL = Prisma.sql`replace(replace(replace(lower(coalesce("mlItemId", '')), '-', ''), ' ', ''), '_', '')`;
const NORMALIZED_SELLER_SQL = Prisma.sql`replace(replace(replace(lower(coalesce("sellerCustomField", '')), '-', ''), ' ', ''), '_', '')`;

const buildSearchFilterSql = (searchFilter: string | null, options?: { lightweight?: boolean }) => {
  if (!searchFilter) return Prisma.empty;
  const tokens = splitSearchTokens(searchFilter);
  if (!tokens.length) return Prisma.empty;

  const normalizedRawToken = normalizeSearchToken(searchFilter);
  if (isLikelyCodeSearch(searchFilter, normalizedRawToken)) {
    const normalizedExactValue = normalizedRawToken;
    const normalizedPrefixValue = `${normalizedRawToken}%`;
    return Prisma.sql`
      AND (
        ${NORMALIZED_SKU_SQL} = ${normalizedExactValue}
        OR ${NORMALIZED_ML_SQL} = ${normalizedExactValue}
        OR ${NORMALIZED_SELLER_SQL} = ${normalizedExactValue}
        OR ${NORMALIZED_SKU_SQL} LIKE ${normalizedPrefixValue}
        OR ${NORMALIZED_ML_SQL} LIKE ${normalizedPrefixValue}
        OR ${NORMALIZED_SELLER_SQL} LIKE ${normalizedPrefixValue}
      )
    `;
  }

  const tokenClauses = tokens.map((token) => {
    const lowerLikeValue = `%${token}%`;
    const normalizedToken = normalizeSearchToken(token);
    const normalizedLikeValue = normalizedToken.length >= 3 ? `%${normalizedToken}%` : null;
    const yearToken = parseSearchYearToken(token);

    const normalizedCodeSql = normalizedLikeValue
      ? Prisma.sql`
          OR ${NORMALIZED_SKU_SQL} LIKE ${normalizedLikeValue}
          OR ${NORMALIZED_ML_SQL} LIKE ${normalizedLikeValue}
          OR ${NORMALIZED_SELLER_SQL} LIKE ${normalizedLikeValue}
        `
      : Prisma.empty;

    const yearSql = yearToken !== null ? buildYearTokenSql(yearToken) : Prisma.empty;

    const isShortToken = token.length <= 2 && yearToken === null;

    if (options?.lightweight || isShortToken) {
      return Prisma.sql`
        (
          lower(COALESCE("skuInternal", '')) LIKE ${lowerLikeValue}
          OR lower(COALESCE("title", '')) LIKE ${lowerLikeValue}
          OR lower(COALESCE("mlItemId", '')) LIKE ${lowerLikeValue}
          OR lower(COALESCE("sellerCustomField", '')) LIKE ${lowerLikeValue}
          OR lower(COALESCE("extraData"->>'pieza', '')) LIKE ${lowerLikeValue}
          OR lower(COALESCE("extraData"->>'marca', '')) LIKE ${lowerLikeValue}
          OR lower(COALESCE("extraData"->>'coche', '')) LIKE ${lowerLikeValue}
          OR lower(COALESCE("extraData"->>'version', '')) LIKE ${lowerLikeValue}
          OR lower(COALESCE("extraData"->>'ano_desde', '')) LIKE ${lowerLikeValue}
          OR lower(COALESCE("extraData"->>'ano_hasta', '')) LIKE ${lowerLikeValue}
          OR lower(COALESCE("extraData"->>'compatibilidades', '')) LIKE ${lowerLikeValue}
          ${normalizedCodeSql}
          ${yearSql}
        )
      `;
    }

    return Prisma.sql`
      (
        ${SEARCH_DOCUMENT_SQL} LIKE ${lowerLikeValue}
        ${normalizedCodeSql}
        ${yearSql}
      )
    `;
  });

  return Prisma.sql`
    AND (${Prisma.join(tokenClauses, " AND ")})
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

type InteractiveSearchSnapshotItem = InventoryListRow & {
  searchText: string;
  normalizedSku: string;
  normalizedMlItemId: string;
  normalizedSellerCustomField: string;
  statusInternal: string;
  marca: string;
  coche: string;
  pieza: string;
  prestadoDebtor: string;
  anoDesde: number | null;
  anoHasta: number | null;
};

type InteractiveSearchCacheEntry = {
  value: InteractiveSearchSnapshotItem[];
  expiresAt: number;
};

const statusTotalsCache = new Map<string, StatusTotalsCacheEntry>();
const statusTotalsInFlight = new Map<string, Promise<Record<string, number>>>();
const interactiveSearchCache = new Map<string, InteractiveSearchCacheEntry>();
const interactiveSearchInFlight = new Map<string, Promise<InteractiveSearchSnapshotItem[]>>();

const statusTotalsCacheKey = (ownerId: string | null) => ownerId ?? "__ALL__";
const interactiveSearchCacheKey = (ownerId: string | null) => ownerId ?? "__ALL__";
const INTERACTIVE_SEARCH_CACHE_TTL_MS = 90 * 1000;

const invalidateStatusTotalsCache = () => {
  statusTotalsCache.clear();
  statusTotalsInFlight.clear();
};

const invalidateInteractiveSearchCache = () => {
  interactiveSearchCache.clear();
  interactiveSearchInFlight.clear();
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

const toSearchTextValue = (value: unknown) => (value === null || value === undefined ? "" : String(value));

const normalizeComparableValue = (value: unknown) => toSearchTextValue(value).trim().toUpperCase();

const normalizeInternalStatusValue = (value: unknown) => {
  const normalized = normalizeComparableValue(value);
  return normalized.length ? normalized : "SIN ESTATUS";
};

const buildStatusTotalsFromSnapshot = (rows: InteractiveSearchSnapshotItem[]) => {
  const totals: Record<string, number> = {};
  rows.forEach((row) => {
    const key = normalizeInternalStatusValue(row.statusInternal);
    totals[key] = (totals[key] ?? 0) + 1;
  });
  return totals;
};

const parseYearValue = (value: unknown) => {
  const raw = toSearchTextValue(value);
  const match = raw.match(/\d{4}/);
  if (!match) return null;
  const year = Number.parseInt(match[0], 10);
  if (!Number.isFinite(year) || year < 1900 || year > 2100) return null;
  return year;
};

const matchesYearRange = (fromYear: number | null, toYear: number | null, year: number) => {
  const normalizedFrom = fromYear ?? toYear;
  const normalizedTo = toYear ?? fromYear;
  if (normalizedFrom === null || normalizedTo === null) return false;
  const minYear = Math.min(normalizedFrom, normalizedTo);
  const maxYear = Math.max(normalizedFrom, normalizedTo);
  return year >= minYear && year <= maxYear;
};

const buildInteractiveSearchText = (item: InventoryListRow) => {
  const extra = item.extraData && typeof item.extraData === "object" && !Array.isArray(item.extraData)
    ? (item.extraData as Record<string, unknown>)
    : {};

  return [
    item.skuInternal,
    item.title,
    extra.descripcion_local,
    extra.descripcion_ml,
    item.mlItemId,
    item.sellerCustomField,
    extra.estatus_interno,
    extra.origen,
    extra.coche,
    extra.version,
    extra.pieza,
    extra.marca,
    extra.ano_desde,
    extra.ano_hasta,
    extra.ubicacion,
    extra.alto,
    extra.largo,
    extra.ancho,
    extra.peso,
    extra.forma_publicacion,
    extra.observaciones,
    extra.compatibilidades,
    extra.inventario,
    extra.revision,
    extra.facebook,
    extra.prestado_vendido_a,
    extra.fecha_prestamo_pago,
    item.stock,
    item.price
  ]
    .map(toSearchTextValue)
    .join(" ")
    .toLowerCase();
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

const loadInteractiveSearchSnapshot = async (ownerId: string | null) => {
  const ownerSql = ownerId ? Prisma.sql`AND "ownerId" = ${ownerId}` : Prisma.empty;

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
  `);

  return rows.map((row) => {
    const extra = row.extraData && typeof row.extraData === "object" && !Array.isArray(row.extraData)
      ? (row.extraData as Record<string, unknown>)
      : {};
    const normalizedPiece = normalizeComparableValue(extra.pieza);

    return {
      ...row,
      searchText: buildInteractiveSearchText(row),
      normalizedSku: normalizeSearchToken(row.skuInternal ?? ""),
      normalizedMlItemId: normalizeSearchToken(row.mlItemId ?? ""),
      normalizedSellerCustomField: normalizeSearchToken(row.sellerCustomField ?? ""),
      statusInternal: normalizeInternalStatusValue(extra.estatus_interno),
      marca: normalizeComparableValue(extra.marca),
      coche: normalizeComparableValue(extra.coche),
      pieza: normalizedPiece.length ? normalizedPiece : normalizeComparableValue(row.title),
      prestadoDebtor: normalizeComparableValue(extra.prestado_vendido_a),
      anoDesde: parseYearValue(extra.ano_desde),
      anoHasta: parseYearValue(extra.ano_hasta)
    } satisfies InteractiveSearchSnapshotItem;
  });
};

const getInteractiveSearchSnapshot = async (ownerId: string | null) => {
  const key = interactiveSearchCacheKey(ownerId);
  const now = Date.now();
  const cached = interactiveSearchCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const inflight = interactiveSearchInFlight.get(key);
  if (inflight) {
    return inflight;
  }

  const task = loadInteractiveSearchSnapshot(ownerId)
    .then((value) => {
      interactiveSearchCache.set(key, {
        value,
        expiresAt: Date.now() + INTERACTIVE_SEARCH_CACHE_TTL_MS
      });
      return value;
    })
    .finally(() => {
      interactiveSearchInFlight.delete(key);
    });

  interactiveSearchInFlight.set(key, task);
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
    const includeMeta = parseIncludeMeta(searchParams);
    const searchTokens = searchFilter ? splitSearchTokens(searchFilter) : [];
    const normalizedSearchToken = searchFilter ? normalizeSearchToken(searchFilter) : "";
    const codeSearchMode = Boolean(searchFilter && isLikelyCodeSearch(searchFilter, normalizedSearchToken));

    if (!includeMeta) {
      let filtered = await getInteractiveSearchSnapshot(ownerId);

      if (searchFilter) {
        if (codeSearchMode) {
          filtered = filtered.filter(
            (row) =>
              row.normalizedSku === normalizedSearchToken ||
              row.normalizedMlItemId === normalizedSearchToken ||
              row.normalizedSellerCustomField === normalizedSearchToken ||
              row.normalizedSku.startsWith(normalizedSearchToken) ||
              row.normalizedMlItemId.startsWith(normalizedSearchToken) ||
              row.normalizedSellerCustomField.startsWith(normalizedSearchToken)
          );
        } else {
          const tokenChecks = searchTokens.map((token) => ({
            token,
            year: parseSearchYearToken(token)
          }));

          filtered = filtered.filter((row) =>
            tokenChecks.every(({ token, year }) => {
              if (row.searchText.includes(token)) return true;
              return year !== null && matchesYearRange(row.anoDesde, row.anoHasta, year);
            })
          );
        }
      }

      if (marcaFilter) {
        filtered = filtered.filter((row) => row.marca === marcaFilter);
      }
      if (cocheFilter) {
        filtered = filtered.filter((row) => row.coche === cocheFilter);
      }
      if (piezaFilter) {
        filtered = filtered.filter((row) => row.pieza === piezaFilter);
      }
      if (prestadoDebtorFilters.length) {
        const debtorSet = new Set(prestadoDebtorFilters);
        filtered = filtered.filter((row) => debtorSet.has(row.prestadoDebtor));
      }

      const statusTotals = buildStatusTotalsFromSnapshot(filtered);

      if (statusFilter) {
        filtered = filtered.filter((row) => row.statusInternal === statusFilter);
      }

      const total = filtered.length;
      const visibleRows = filtered.slice(skip, skip + pageSize);
      const serialized = visibleRows.map((rawRow) => {
        const result = serializeInventoryItem(rawRow);
        result.photoCount = Number(rawRow.photoCount ?? 0);
        return result;
      });
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

    const shouldUseLightweightSearch =
      searchTokens.length > 0 &&
      searchTokens.some((token) => token.length <= 2 && parseSearchYearToken(token) === null);

    const ownerSql = ownerId ? Prisma.sql`AND "ownerId" = ${ownerId}` : Prisma.empty;
    const statusSql = buildStatusFilterSql(statusFilter);
    const searchSql = buildSearchFilterSql(searchFilter, { lightweight: shouldUseLightweightSearch });
    const marcaSql = buildMarcaFilterSql(marcaFilter);
    const cocheSql = buildCocheFilterSql(cocheFilter);
    const piezaSql = buildPiezaFilterSql(piezaFilter);
    const prestadoDebtorSql = buildPrestadoDebtorFilterSql(prestadoDebtorFilters);

    if (statusFilter || searchFilter || marcaFilter || cocheFilter || piezaFilter || prestadoDebtorFilters.length) {
      const hasNoAdditionalFilters =
        !statusFilter && !marcaFilter && !cocheFilter && !piezaFilter && !prestadoDebtorFilters.length;
      const fastSearchMode = Boolean(searchFilter && hasNoAdditionalFilters && page === 1);
      const fastCodeSearchMode = codeSearchMode && fastSearchMode;
      const shouldUseFastCount = fastSearchMode || fastCodeSearchMode || !includeMeta;
      const shouldLoadPrestadoMetrics = statusFilter === "PRESTADO";

      const [dataRows, countRows, statusTotals, prestadoMetrics, facetOptions] = await Promise.all([
        prisma.$queryRaw<InventoryListRow[]>(Prisma.sql`
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
          ${statusSql}
          ${searchSql}
          ${marcaSql}
          ${cocheSql}
          ${piezaSql}
          ${prestadoDebtorSql}
          ORDER BY "updatedAt" DESC
          OFFSET ${skip}
          LIMIT ${shouldUseFastCount ? pageSize + 1 : pageSize}
        `),
        shouldUseFastCount
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
        includeMeta
          ? getStatusTotals(ownerId)
          : Promise.resolve<Record<string, number> | null>(null),
        includeMeta && shouldLoadPrestadoMetrics
          ? getPrestadoMetrics({ ownerSql, statusSql, searchSql, marcaSql, cocheSql, piezaSql, prestadoDebtorSql })
          : Promise.resolve<PrestadoMetrics | null>(null),
        includeMeta && includeFacetOptions
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

      const hasMoreFastRows = shouldUseFastCount && dataRows.length > pageSize;
      const visibleRows = hasMoreFastRows ? dataRows.slice(0, pageSize) : dataRows;

      const total = shouldUseFastCount
        ? hasMoreFastRows
          ? skip + pageSize + 1
          : skip + visibleRows.length
        : Number(countRows[0]?.count ?? 0);
      const serialized = visibleRows.map((rawRow) => {
        const result = serializeInventoryItem(rawRow);
        result.photoCount = Number(rawRow.photoCount ?? 0);
        return result;
      });
      const totalPages = Math.max(1, Math.ceil(total / pageSize));

      return NextResponse.json({
        page,
        pageSize,
        total,
        totalPages,
        statusTotals: includeMeta ? statusTotals : undefined,
        prestadoMetrics: includeMeta ? prestadoMetrics : undefined,
        facetOptions: includeMeta && includeFacetOptions ? facetOptions : undefined,
        items: serialized
      });
    }

    const shouldUseFastCount = !includeMeta;

    const [items, countRows, statusTotals, facetOptions] = await Promise.all([
      prisma.inventoryItem.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip,
        take: shouldUseFastCount ? pageSize + 1 : pageSize
      }),
      shouldUseFastCount
        ? Promise.resolve<CountRow[]>([])
        : prisma.$queryRaw<CountRow[]>(Prisma.sql`
            SELECT COUNT(*) AS count
            FROM "InventoryItem"
            WHERE 1=1
            ${ownerSql}
          `),
      includeMeta
        ? getStatusTotals(ownerId)
        : Promise.resolve<Record<string, number> | null>(null),
      includeMeta && includeFacetOptions
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

    const hasMoreFastRows = shouldUseFastCount && items.length > pageSize;
    const visibleItems = hasMoreFastRows ? items.slice(0, pageSize) : items;
    const total = shouldUseFastCount
      ? hasMoreFastRows
        ? skip + pageSize + 1
        : skip + visibleItems.length
      : Number(countRows[0]?.count ?? 0);

    const serialized = visibleItems.map((item) => serializeInventoryItem(item));
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    return NextResponse.json({
      page,
      pageSize,
      total,
      totalPages,
      statusTotals: includeMeta ? statusTotals : undefined,
      facetOptions: includeMeta && includeFacetOptions ? facetOptions : undefined,
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
  const normalizedSku = normalizeSkuInternal(data.skuInternal);
  if (!normalizedSku.length) {
    return NextResponse.json({ error: "SKU invalido" }, { status: 400 });
  }

  const duplicateSku = await findInventoryItemBySkuGlobal(normalizedSku);
  if (duplicateSku) {
    return NextResponse.json({ error: GLOBAL_DUPLICATE_SKU_ERROR }, { status: 409 });
  }

  try {
    const item = await prisma.inventoryItem.create({
      data: {
        skuInternal: normalizedSku,
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
          metadata: { skuInternal: normalizedSku }
        }
      });
    } catch (logErr) {
      console.error("Error al crear auditLog de inventario", logErr);
    }

    revalidateInventorySnapshotCache();
    invalidateStatusTotalsCache();
    invalidateInteractiveSearchCache();

    return NextResponse.json(serializeInventoryItem(item, { includePhotos: true }), { status: 201 });
  } catch (err: any) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ error: GLOBAL_DUPLICATE_SKU_ERROR }, { status: 409 });
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
  invalidateInteractiveSearchCache();

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
    version,
    anoDesde,
    anoHasta,
    alto,
    largo,
    ancho,
    peso,
    formaPublicacion,
    observaciones,
    compatibilidades,
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

  if (version && version.trim()) {
    nextExtra.version = version.trim();
  } else if (version === null) {
    delete nextExtra.version;
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

  if (alto && alto.trim()) {
    nextExtra.alto = alto.trim();
  } else if (alto === null) {
    delete nextExtra.alto;
  }

  if (largo && largo.trim()) {
    nextExtra.largo = largo.trim();
  } else if (largo === null) {
    delete nextExtra.largo;
  }

  if (ancho && ancho.trim()) {
    nextExtra.ancho = ancho.trim();
  } else if (ancho === null) {
    delete nextExtra.ancho;
  }

  if (peso && peso.trim()) {
    nextExtra.peso = peso.trim();
  } else if (peso === null) {
    delete nextExtra.peso;
  }

  if (formaPublicacion && formaPublicacion.trim()) {
    nextExtra.forma_publicacion = formaPublicacion.trim();
  } else if (formaPublicacion === null) {
    delete nextExtra.forma_publicacion;
  }

  if (observaciones && observaciones.trim()) {
    nextExtra.observaciones = observaciones.trim();
  } else if (observaciones === null) {
    delete nextExtra.observaciones;
  }

  if (compatibilidades && compatibilidades.trim()) {
    nextExtra.compatibilidades = compatibilidades.trim();
  } else if (compatibilidades === null) {
    delete nextExtra.compatibilidades;
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
    const normalizedSku = normalizeSkuInternal(skuInternal);
    if (!normalizedSku) {
      return NextResponse.json({ error: "SKU invalido" }, { status: 400 });
    }

    const duplicateSku = await findInventoryItemBySkuGlobal(normalizedSku, id);
    if (duplicateSku) {
      return NextResponse.json({ error: GLOBAL_DUPLICATE_SKU_ERROR }, { status: 409 });
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
      return NextResponse.json({ error: GLOBAL_DUPLICATE_SKU_ERROR }, { status: 409 });
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
        version: version ?? null,
        anoDesde: anoDesde ?? null,
        anoHasta: anoHasta ?? null,
        alto: alto ?? null,
        largo: largo ?? null,
        ancho: ancho ?? null,
        peso: peso ?? null,
        formaPublicacion: formaPublicacion ?? null,
        observaciones: observaciones ?? null,
        compatibilidades: compatibilidades ?? null,
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
  invalidateInteractiveSearchCache();

  return NextResponse.json({
    ...serializeInventoryItem(item),
    mlSyncError
  });
}
