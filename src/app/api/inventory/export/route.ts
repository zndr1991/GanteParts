export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { z } from "zod";

const EXPORT_FIELD_KEYS = [
  "skuInternal",
  "marca",
  "coche",
  "anoDesde",
  "anoHasta",
  "mlItemId",
  "estatusInterno",
  "precio",
  "descripcion",
  "descripcionLocal",
  "largo",
  "alto",
  "ancho",
  "peso",
  "formaPublicacion",
  "observaciones",
  "compatibilidades"
] as const;

type ExportFieldKey = (typeof EXPORT_FIELD_KEYS)[number];

type InventoryExportRecord = {
  id: string;
  skuInternal: string;
  title: string | null;
  price: Prisma.Decimal | null;
  mlItemId: string | null;
  extraData: Prisma.JsonValue;
};

const exportSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(5000),
  fields: z.array(z.enum(EXPORT_FIELD_KEYS)).min(1).max(EXPORT_FIELD_KEYS.length).optional()
});

const toText = (value: unknown) => {
  if (value === null || value === undefined) return "";
  return String(value).trim();
};

const buildYearRangeText = (fromValue: unknown, toValue: unknown) => {
  const from = toText(fromValue);
  const to = toText(toValue);
  if (!from && !to) return "";
  if (from && to) {
    if (from === to) return from;
    return `${from} AL ${to}`;
  }
  return from || to;
};

const parseYearFromValue = (value: unknown) => {
  const match = toText(value).match(/\d{4}/);
  if (!match) return null;
  const year = Number.parseInt(match[0], 10);
  if (!Number.isFinite(year) || year < 1900 || year > 2100) return null;
  return year;
};

const buildExpandedYearsText = (fromValue: unknown, toValue: unknown) => {
  const fromYear = parseYearFromValue(fromValue);
  const toYear = parseYearFromValue(toValue);

  if (fromYear !== null && toYear !== null) {
    const minYear = Math.min(fromYear, toYear);
    const maxYear = Math.max(fromYear, toYear);
    const span = Math.min(maxYear - minYear, 120);
    const years: string[] = [];
    for (let year = minYear; year <= minYear + span; year += 1) {
      years.push(String(year));
    }
    return years.join(" ");
  }

  if (fromYear !== null) return String(fromYear);
  if (toYear !== null) return String(toYear);

  const fromText = toText(fromValue);
  const toTextValue = toText(toValue);
  if (fromText && toTextValue) {
    if (fromText === toTextValue) return fromText;
    return `${fromText} ${toTextValue}`;
  }
  return fromText || toTextValue;
};

const buildExpandedYearsSequence = (fromYear: number, toYear: number) => {
  const minYear = Math.min(fromYear, toYear);
  const maxYear = Math.max(fromYear, toYear);
  const span = Math.min(maxYear - minYear, 120);
  const years: string[] = [];
  for (let year = minYear; year <= minYear + span; year += 1) {
    years.push(String(year));
  }
  return years.join(" ");
};

const expandYearRangesInText = (value: unknown) => {
  const raw = toText(value);
  if (!raw) return "";

  const expandRange = (_match: string, fromRaw: string, toRaw: string) => {
    const fromYear = Number.parseInt(fromRaw, 10);
    const toYear = Number.parseInt(toRaw, 10);
    if (!Number.isFinite(fromYear) || !Number.isFinite(toYear)) {
      return _match;
    }
    if (fromYear < 1900 || fromYear > 2100 || toYear < 1900 || toYear > 2100) {
      return _match;
    }
    return buildExpandedYearsSequence(fromYear, toYear);
  };

  let expanded = raw;
  expanded = expanded.replace(/\b(\d{4})\s*-\s*(\d{4})\b/g, expandRange);
  expanded = expanded.replace(/\b(\d{4})\s+AL\s+(\d{4})\b/gi, expandRange);
  return expanded;
};

const firstNonEmpty = (...values: unknown[]) => {
  for (const value of values) {
    const normalized = toText(value);
    if (normalized.length) return normalized;
  }
  return "";
};

const toExtraDataRecord = (value: Prisma.JsonValue): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
};

const normalizeInternalStatus = (value: unknown) => {
  const status = toText(value).toUpperCase();
  return status.length ? status : "SIN ESTATUS";
};

const toNumberOrEmpty = (value: Prisma.Decimal | null) => {
  if (value === null) return "";
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "";
  return parsed;
};

const NUEVO_ORIGINAL_DESCRIPCION =
  "PIEZA NUEVA ORIGINAL PUEDE QUE TENGA RASPONES DE ALMACENAMIENTO QUE NO AFECTAN EN NADA A SU FUNCIONAMIENTO.\n" +
  "SI NECESITA MAS FOTOS ENVIE MENSAJE ESTAREMOS AL PENDIENTE PARA RESPONDER LO MAS PRONTO POSIBLE.\n\n" +
  "SI FACTURAMOS, PRECIO YA INCLUYE IVA";

const NUEVO_ORIGINAL_DETALLE_DESCRIPCION =
  "PIEZA ORIGINAL CON DANOS APRECIABLES EN FOTOS SI NECESITA MAS FOTOS ENVIE MENSAJE ESTAREMOS AL PENDIENTE PARA RESPONDER LO MAS PRONTO POSIBLE (NUEVO SE REFIERE A QUE NUNCA FUE INSTALADA). SI FACTURAMOS, PRECIO YA INCLUYE IVA";

const TW_GENERICO_DESCRIPCION =
  "PIEZA NUEVA TW/GENERICA/NO ORIGINAL\nSI NECESITA MAS FOTOS ENVIE MENSAJE ESTAREMOS AL PENDIENTE PARA RESPONDER LO MAS PRONTO POSIBLE. SI FACTURAMOS, PRECIO YA INCLUYE IVA";

const TW_GENERICO_DETALLE_DESCRIPCION =
  "PIEZA TW/GENERICA/NO ORIGINAL CON DANOS APRECIABLES EN FOTOS\nSI NECESITA MAS FOTOS ENVIE MENSAJE ESTAREMOS AL PENDIENTE PARA RESPONDER LO MAS PRONTO POSIBLE. SI FACTURAMOS, PRECIO YA INCLUYE IVA";

const USADO_ORIGINAL_SANO_DESCRIPCION =
  "PIEZA USADA ORIGINAL EN BUENAS CONDICIONES\nSI NECESITA MAS FOTOS ENVIE MENSAJE ESTAREMOS AL PENDIENTE PARA RESPONDER LO MAS PRONTO POSIBLE. SI FACTURAMOS, PRECIO YA INCLUYE IVA";

const USADO_ORIGINAL_DETALLE_DESCRIPCION =
  "PIEZA CON DANOS APRECIABLES EN FOTOS SI NECESITA MAS FOTOS ENVIE MENSAJE ESTAREMOS AL PENDIENTE PARA RESPONDER LO MAS PRONTO POSIBLE. SI FACTURAMOS, PRECIO YA INCLUYE IVA";

const buildDescripcionLocalValue = (item: InventoryExportRecord, extra: Record<string, unknown>) => {
  const base = firstNonEmpty(extra.descripcion_local, extra.descripcionLocal);
  const origen = toText(extra.origen).toUpperCase();
  const withPrefix = (template: string) => (base.length ? `${base}\n\n${template}` : template);
  const yearsExpanded = buildExpandedYearsText(extra.ano_desde, extra.ano_hasta);
  const compatibilidadesValue = expandYearRangesInText(firstNonEmpty(extra.compatibilidades, extra.compatibilidad));
  const observacionesValue = toText(extra.observaciones);
  const detailsLine = [
    toText(extra.pieza),
    toText(extra.marca),
    toText(extra.coche),
    toText(extra.version),
    yearsExpanded
  ]
    .filter((part) => part.length)
    .join(" ");
  const firstFooterLine = detailsLine.length
    ? compatibilidadesValue.length
      ? `${detailsLine} /${compatibilidadesValue}`
      : detailsLine
    : compatibilidadesValue;
  const footerLines = [
    firstFooterLine,
    observacionesValue,
    "GantePartsGDL"
  ].join("\n");
  const attachFooter = (content: string) => (content.length ? `${content}\n\n${footerLines}` : footerLines);

  switch (origen) {
    case "NUEVO ORIGINAL":
      return attachFooter(withPrefix(NUEVO_ORIGINAL_DESCRIPCION));
    case "NUEVO ORIGINAL CON DETALLE":
      return attachFooter(withPrefix(NUEVO_ORIGINAL_DETALLE_DESCRIPCION));
    case "TW/GENERICO":
      return attachFooter(withPrefix(TW_GENERICO_DESCRIPCION));
    case "TW/GENERICO CON DETALLE":
      return attachFooter(withPrefix(TW_GENERICO_DETALLE_DESCRIPCION));
    case "USADO ORIGINAL SANO":
      return attachFooter(withPrefix(USADO_ORIGINAL_SANO_DESCRIPCION));
    case "USADO ORIGINAL CON DETALLE":
      return attachFooter(withPrefix(USADO_ORIGINAL_DETALLE_DESCRIPCION));
    default:
      return attachFooter(firstNonEmpty(base, extra.descripcion_ml, extra.descripcion, item.title));
  }
};

const fieldHeaders: Record<ExportFieldKey, string> = {
  skuInternal: "SKU",
  marca: "MARCA",
  coche: "COCHE",
  anoDesde: "ANO DESDE",
  anoHasta: "ANO HASTA",
  mlItemId: "CODIGO ML",
  estatusInterno: "ESTATUS INTERNO",
  precio: "PRECIO",
  descripcion: "TITULO ML",
  descripcionLocal: "DESCRIPCION LOCAL",
  largo: "ANCHO",
  alto: "ALTO",
  ancho: "PROFUNDIDAD",
  peso: "PESO",
  formaPublicacion: "FORMA PUBLICACION",
  observaciones: "OBSERVACIONES",
  compatibilidades: "COMPATIBILIDADES"
};

const buildFieldValue = (field: ExportFieldKey, item: InventoryExportRecord, extra: Record<string, unknown>) => {
  switch (field) {
    case "skuInternal":
      return item.skuInternal;
    case "marca":
      return toText(extra.marca);
    case "coche":
      return toText(extra.coche);
    case "anoDesde":
      return toText(extra.ano_desde);
    case "anoHasta":
      return toText(extra.ano_hasta);
    case "mlItemId":
      return toText(item.mlItemId);
    case "estatusInterno":
      return normalizeInternalStatus(extra.estatus_interno);
    case "precio":
      return toNumberOrEmpty(item.price);
    case "descripcion": {
      const yearRange = buildYearRangeText(extra.ano_desde, extra.ano_hasta);
      const titleParts = [
        toText(extra.pieza),
        toText(extra.marca),
        toText(extra.version),
        yearRange,
        item.skuInternal
      ].filter((part) => part.length);
      return titleParts.length ? titleParts.join(" ") : firstNonEmpty(item.title, extra.descripcion_ml, extra.descripcion);
    }
    case "descripcionLocal":
      return buildDescripcionLocalValue(item, extra);
    case "alto":
      return toText(extra.alto);
    case "largo":
      return toText(extra.largo);
    case "ancho":
      return toText(extra.ancho);
    case "peso":
      return toText(extra.peso);
    case "formaPublicacion":
      return toText(extra.forma_publicacion);
    case "observaciones":
      return toText(extra.observaciones);
    case "compatibilidades":
      return toText(extra.compatibilidades);
    default:
      return "";
  }
};

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  let payloadRaw: unknown;
  try {
    payloadRaw = await req.json();
  } catch {
    return NextResponse.json({ error: "Solicitud invalida" }, { status: 400 });
  }

  const parsed = exportSchema.safeParse(payloadRaw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Solicitud invalida" }, { status: 400 });
  }

  const role = (session.user.role ?? "").toLowerCase();
  const ownerId = role === "viewer" ? session.user.id : null;
  const ids = Array.from(new Set(parsed.data.ids));
  const fields = parsed.data.fields?.length
    ? Array.from(new Set(parsed.data.fields))
    : [...EXPORT_FIELD_KEYS];

  const where: Prisma.InventoryItemWhereInput = {
    id: { in: ids }
  };

  if (ownerId) {
    where.ownerId = ownerId;
  }

  const items = await prisma.inventoryItem.findMany({
    where,
    select: {
      id: true,
      skuInternal: true,
      title: true,
      price: true,
      mlItemId: true,
      extraData: true
    }
  });

  const itemMap = new Map(items.map((item) => [item.id, item]));
  const orderedItems = ids
    .map((id) => itemMap.get(id))
    .filter((item): item is InventoryExportRecord => Boolean(item));

  if (!orderedItems.length) {
    return NextResponse.json({ error: "No hay renglones disponibles para exportar" }, { status: 404 });
  }

  const headers = fields.map((field) => fieldHeaders[field]);
  const rows = orderedItems.map((item) => {
    const extra = toExtraDataRecord(item.extraData);
    return fields.map((field) => buildFieldValue(field, item, extra));
  });

  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Inventario");
  const fileBuffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

  const dateLabel = new Date().toISOString().slice(0, 10);
  return new NextResponse(fileBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename=reporte-inventario-${dateLabel}.xlsx`,
      "x-export-count": String(orderedItems.length)
    }
  });
}
