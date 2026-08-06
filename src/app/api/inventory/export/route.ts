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
  "alto",
  "largo",
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

const fieldHeaders: Record<ExportFieldKey, string> = {
  skuInternal: "SKU",
  marca: "MARCA",
  coche: "COCHE",
  anoDesde: "ANO DESDE",
  anoHasta: "ANO HASTA",
  mlItemId: "CODIGO ML",
  estatusInterno: "ESTATUS INTERNO",
  precio: "PRECIO",
  descripcion: "DESCRIPCION",
  descripcionLocal: "DESCRIPCION LOCAL",
  alto: "ALTO",
  largo: "LARGO",
  ancho: "ANCHO",
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
    case "descripcion":
      return firstNonEmpty(item.title, extra.descripcion_ml, extra.descripcion, extra.pieza);
    case "descripcionLocal":
      return toText(extra.descripcion_local);
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
