export const dynamic = "force-dynamic";
export const runtime = "nodejs";
import { auth } from "@/lib/auth";
import { invalidateInventoryFullSnapshot } from "@/lib/inventory-full-snapshot";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function toNumberSafe(value: any): number | null {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  if (!str) return null;
  const cleaned = str.replace(/,/g, ".").replace(/[^0-9.-]/g, "");
  const num = Number(cleaned);
  if (Number.isNaN(num)) return null;
  return num;
}

function normalizeFormaPublicacion(value: unknown): string {
  const normalized = (value ?? "").toString().trim().toLowerCase();
  if (!normalized.length) return "";
  if (normalized === "envio gratis" || normalized === "sin envio gratis") return normalized;
  if (normalized === "premium") return "envio gratis";
  if (normalized === "clasica") return "sin envio gratis";
  return "";
}

const headerMap: Record<string, string> = {
  sku: "skuInternal",
  skuinternal: "skuInternal",
  skuinterno: "skuInternal",
  codigo: "skuInternal",
  codigouniversal: "sellerCustomField",
  sellercustomfield: "sellerCustomField",
  mlitemid: "mlItemId",
  itemid: "mlItemId",
  codigodemercadolibre: "mlItemId",
  descripcionml: "extra_descripcion_ml",
  "descripcion ml": "extra_descripcion_ml",
  descripcion: "title",
  title: "title",
  titulo: "title",
  price: "price",
  precio: "price",
  stock: "stock",
  cantidad: "stock",
  inventario: "stock",
  estatus: "status",
  estatusinterno: "extra_estatus_interno",
  "estatus interno": "extra_estatus_interno",
  origen: "extra_origen",
  marca: "extra_marca",
  coche: "extra_coche",
  version: "extra_version",
  versiondelcoche: "extra_version",
  anodesde: "extra_ano_desde",
  "año desde": "extra_ano_desde",
  anohasta: "extra_ano_hasta",
  "año hasta": "extra_ano_hasta",
  alto: "extra_alto",
  largo: "extra_largo",
  profundidad: "extra_largo",
  ancho: "extra_ancho",
  peso: "extra_peso",
  formadepublicacion: "extra_forma_publicacion",
  formapublicacion: "extra_forma_publicacion",
  observaciones: "extra_observaciones",
  observacion: "extra_observaciones",
  compatibilidades: "extra_compatibilidades",
  compatibilidad: "extra_compatibilidades",
  ubicacion: "extra_ubicacion",
  facebook: "extra_facebook",
  descripcionlocal: "extra_descripcion_local",
  "descripcion local": "extra_descripcion_local",
  pieza: "extra_pieza"
};

const statusMap: Record<string, string> = {
  active: "active",
  activo: "active",
  "en venta": "active",
  paused: "paused",
  pausado: "paused",
  inactivo: "inactive",
  inactive: "inactive"
};

const canImportInventory = (role?: string | null) => {
  const normalized = (role ?? "").toLowerCase();
  return normalized === "admin";
};

const GLOBAL_DUPLICATE_SKU_ERROR = "SKU interno ya existe en la base de datos";

const normalizeSkuInternal = (value: unknown) => String(value ?? "").trim().toUpperCase();

export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!canImportInventory(session.user?.role)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: "Falta archivo" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) {
    return NextResponse.json({ error: "Archivo vacio" }, { status: 400 });
  }

  const rows = XLSX.utils.sheet_to_json<Record<string, any>>(workbook.Sheets[firstSheet], { defval: "" });
  const errors: string[] = [];
  const parsedRows: Array<{ rowNumber: number; sku: string; data: Prisma.InventoryItemCreateManyInput }> = [];
  const seenSkusInFile = new Set<string>();

  rows.forEach((row, idx) => {
    const rowNumber = idx + 2;
    const normalized: Record<string, any> = {};
    Object.entries(row).forEach(([key, value]) => {
      const mapped = headerMap[normalizeHeader(key)];
      if (mapped) normalized[mapped] = value;
    });

    const sku = normalizeSkuInternal(normalized.skuInternal);
    if (!sku) {
      errors.push(`Fila ${rowNumber}: SKU requerido`);
      return;
    }

    if (seenSkusInFile.has(sku)) {
      errors.push(`Fila ${rowNumber}: SKU duplicado en el archivo (${sku})`);
      return;
    }
    seenSkusInFile.add(sku);

    const priceRaw = normalized.price;
    const stockRaw = normalized.stock;

    let price = toNumberSafe(priceRaw);
    if (price !== null && price < 0) price = 0;

    let stock = toNumberSafe(stockRaw);
    if (stock === null || Number.isNaN(stock)) stock = 0;
    if (stock < 0) stock = 0;

    const statusRaw = normalized.status ? String(normalized.status).toLowerCase().trim() : undefined;
    const statusValue = statusRaw ? statusMap[statusRaw] : undefined;

    const extras: Record<string, any> = {};
    Object.entries(normalized).forEach(([key, value]) => {
      if (key.startsWith("extra_")) {
        const cleanKey = key.replace("extra_", "");
        if (cleanKey === "forma_publicacion") {
          const normalizedForma = normalizeFormaPublicacion(value);
          if (normalizedForma) {
            extras[cleanKey] = normalizedForma;
          }
          return;
        }
        if (cleanKey === "version") {
          const normalizedVersion = String(value ?? "").trim().toUpperCase();
          if (normalizedVersion) {
            extras[cleanKey] = normalizedVersion;
          }
          return;
        }
        extras[cleanKey] = value;
      }
    });

    parsedRows.push({
      rowNumber,
      sku,
      data: {
      skuInternal: sku,
      title: normalized.title ? String(normalized.title) : null,
      price: price !== null ? new Prisma.Decimal(price) : null,
      stock,
      mlItemId: normalized.mlItemId ? String(normalized.mlItemId) : null,
      sellerCustomField: normalized.sellerCustomField ? String(normalized.sellerCustomField) : null,
      ownerId: userId,
      status: statusValue,
      extraData: Object.keys(extras).length ? extras : undefined
      }
    });
  });

  if (parsedRows.length === 0) {
    return NextResponse.json({ error: "Sin filas validas", errors }, { status: 400 });
  }

  const uniqueSkus = Array.from(new Set(parsedRows.map((entry) => entry.sku)));
  const existingRows = uniqueSkus.length
    ? await prisma.$queryRaw<Array<{ sku: string }>>(Prisma.sql`
      SELECT UPPER(TRIM(COALESCE("skuInternal", ''))) AS sku
      FROM "InventoryItem"
      WHERE UPPER(TRIM(COALESCE("skuInternal", ''))) IN (${Prisma.join(uniqueSkus)})
    `)
    : [];

  const existingSkuSet = new Set(existingRows.map((entry) => normalizeSkuInternal(entry.sku)));
  const insertableData: Prisma.InventoryItemCreateManyInput[] = [];

  parsedRows.forEach((entry) => {
    if (existingSkuSet.has(entry.sku)) {
      errors.push(`Fila ${entry.rowNumber}: ${GLOBAL_DUPLICATE_SKU_ERROR} (${entry.sku})`);
      return;
    }
    insertableData.push(entry.data);
  });

  if (!insertableData.length) {
    return NextResponse.json({ error: GLOBAL_DUPLICATE_SKU_ERROR, inserted: 0, errors: errors.slice(0, 25) }, { status: 409 });
  }

  const result = await prisma.inventoryItem.createMany({ data: insertableData, skipDuplicates: true });

  await prisma.auditLog.create({
    data: {
      action: "inventory:import",
      userId,
      metadata: {
        totalRows: rows.length,
        inserted: result.count,
        skipped: parsedRows.length - result.count,
        errors: errors.length
      }
    }
  });

  revalidateTag("inventory-initial");
  invalidateInventoryFullSnapshot();

  return NextResponse.json({ inserted: result.count, errors: errors.slice(0, 25) });
}
