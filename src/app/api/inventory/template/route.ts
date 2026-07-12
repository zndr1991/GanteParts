export const dynamic = "force-dynamic";
export const runtime = "nodejs";
import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

const HEADERS = [
  "ESTATUS",
  "DESCRIPCION",
  "DESCRIPCION ML",
  "PRECIO",
  "CODIGO",
  "STOCK",
  "CODIGO UNIVERSAL",
  "CODIGO DE MERCADO LIBRE",
  "ESTATUS INTERNO",
  "ORIGEN",
  "MARCA",
  "COCHE",
  "AÑO DESDE",
  "AÑO HASTA",
  "FACEBOOK",
  "UBICACION",
  "DESCRIPCION LOCAL",
  "PIEZA",
  "ALTO",
  "LARGO",
  "ANCHO",
  "PESO",
  "FORMA DE PUBLICACION",
  "OBSERVACIONES",
  "COMPATIBILIDADES"
];

export async function GET() {
  const worksheet = XLSX.utils.aoa_to_sheet([HEADERS]);

  // Validaciones de lista (celdas A, I, J, W filas 2-500). MARCA, COCHE y AÑOS quedan libres para capturar nuevas opciones.
  const dataValidations = [
    {
      type: "list",
      allowBlank: true,
      sqref: "A2:A500",
      ref: "A2:A500",
      formulas: ['"active,paused,inactive"']
    },
    {
      type: "list",
      allowBlank: true,
      sqref: "I2:I500",
      ref: "I2:I500",
      formulas: ['"ML,PRESTADO,VENDIDO,FOTOS,FALTA UBICACION,NO ESTA,CHECAR,SIN SUBIR"']
    },
    {
      type: "list",
      allowBlank: true,
      sqref: "J2:J500",
      ref: "J2:J500",
      formulas: ['"NUEVO ORIGINAL,NUEVO ORIGINAL CON DETALLE,TW/GENERICO,TW/GENERICO CON DETALLE,USADO ORIGINAL SANO,USADO ORIGINAL CON DETALLE"']
    },
    {
      type: "list",
      allowBlank: true,
      sqref: "W2:W500",
      ref: "W2:W500",
      formulas: ['"envio gratis,sin envio gratis"']
    }
  ];

  // Compatibilidad: algunas versiones leen !dataValidation (singular) o !dataValidations (plural)
  (worksheet as any)["!dataValidations"] = dataValidations;
  (worksheet as any)["!dataValidation"] = dataValidations;
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Plantilla");

  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": "attachment; filename=plantilla-inventario.xlsx"
    }
  });
}