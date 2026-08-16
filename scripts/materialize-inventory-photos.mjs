/**
 * One-time / incremental: mueve data:image base64 de extraData.photos a archivos locales
 * y deja solo rutas/URLs en la BD. NO borra fotos; solo cambia la forma de almacenarlas.
 *
 * Uso (en el servidor, dentro del proyecto):
 *   NODE_PATH=./node_modules node scripts/materialize-inventory-photos.mjs
 *   BATCH=25 LIMIT=200 NODE_PATH=./node_modules node scripts/materialize-inventory-photos.mjs
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const UPLOAD_ROOT = path.join(PROJECT_ROOT, "public", "uploads", "inventory");
const MAX_PHOTOS = 8;
const BATCH = Math.max(1, Number(process.env.BATCH ?? 20) || 20);
const LIMIT = Math.max(0, Number(process.env.LIMIT ?? 0) || 0);
const SLEEP_MS = Math.max(0, Number(process.env.SLEEP_MS ?? 50) || 0);

const prisma = new PrismaClient();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const extensionFromMime = (mimeType) => {
  const normalized = (mimeType || "").toLowerCase();
  if (normalized.includes("png")) return "png";
  if (normalized.includes("webp")) return "webp";
  if (normalized.includes("gif")) return "gif";
  if (normalized.includes("jpeg") || normalized.includes("jpg")) return "jpg";
  return "bin";
};

const parseDataUrl = (value) => {
  const match = String(value || "").match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/i);
  if (!match) return null;
  try {
    const buffer = Buffer.from(match[2], "base64");
    if (!buffer.length) return null;
    return { mimeType: match[1], buffer };
  } catch {
    return null;
  }
};

const extractPhotoSource = (entry) => {
  if (typeof entry === "string") return entry.trim();
  if (!entry || typeof entry !== "object") return "";
  const candidate = entry.url ?? entry.dataUrl ?? entry.src ?? entry.preview ?? entry.source;
  return typeof candidate === "string" ? candidate.trim() : "";
};

const sanitizePhotos = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map(extractPhotoSource).filter((entry) => entry.length).slice(0, MAX_PHOTOS);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length ? [trimmed] : [];
  }
  const fromObject = extractPhotoSource(value);
  return fromObject.length ? [fromObject] : [];
};

const materializePhotos = async (itemId, photos) => {
  const normalized = Array.from(new Set(sanitizePhotos(photos))).slice(0, MAX_PHOTOS);
  if (!normalized.length) return { photos: [], changed: false, dataUrlCount: 0 };

  const itemDir = path.join(UPLOAD_ROOT, itemId);
  await mkdir(itemDir, { recursive: true });

  let changed = false;
  let dataUrlCount = 0;
  const result = [];

  for (let index = 0; index < normalized.length; index += 1) {
    const photo = normalized[index];
    if (photo.startsWith("http://") || photo.startsWith("https://") || photo.startsWith("/uploads/")) {
      result.push(photo);
      continue;
    }

    const parsed = parseDataUrl(photo);
    if (!parsed) {
      result.push(photo);
      continue;
    }

    dataUrlCount += 1;
    const digest = createHash("sha1").update(parsed.buffer).digest("hex").slice(0, 12);
    const ext = extensionFromMime(parsed.mimeType);
    const fileName = `${String(index + 1).padStart(2, "0")}-${digest}.${ext}`;
    const absPath = path.join(itemDir, fileName);
    await writeFile(absPath, parsed.buffer);
    result.push(`/uploads/inventory/${itemId}/${fileName}`);
    changed = true;
  }

  return { photos: result, changed, dataUrlCount };
};

async function main() {
  console.log(
    JSON.stringify(
      {
        start: new Date().toISOString(),
        batch: BATCH,
        limit: LIMIT || "all",
        uploadRoot: UPLOAD_ROOT
      },
      null,
      2
    )
  );

  let processed = 0;
  let updated = 0;
  let dataUrls = 0;
  let errors = 0;
  let offset = 0;

  while (true) {
    if (LIMIT > 0 && processed >= LIMIT) break;

    const take = LIMIT > 0 ? Math.min(BATCH, LIMIT - processed) : BATCH;
    const rows = await prisma.$queryRaw`
      SELECT id, "extraData"->'photos' AS photos
      FROM "InventoryItem"
      WHERE jsonb_typeof("extraData"->'photos') = 'array'
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text("extraData"->'photos') photo
          WHERE photo LIKE 'data:image%'
        )
      ORDER BY "updatedAt" DESC
      LIMIT ${take}
    `;

    if (!rows.length) {
      console.log("No quedan filas con data:image en photos.");
      break;
    }

    for (const row of rows) {
      processed += 1;
      try {
        const { photos, changed, dataUrlCount } = await materializePhotos(row.id, row.photos);
        dataUrls += dataUrlCount;
        if (!changed) continue;

        await prisma.$executeRaw`
          UPDATE "InventoryItem"
          SET
            "extraData" = jsonb_set(
              COALESCE("extraData", '{}'::jsonb),
              '{photos}',
              ${JSON.stringify(photos)}::jsonb,
              true
            ),
            "updatedAt" = NOW()
          WHERE id = ${row.id}
        `;
        updated += 1;
      } catch (error) {
        errors += 1;
        console.error(`[fail] ${row.id}`, error?.message || error);
      }

      if (SLEEP_MS > 0) await sleep(SLEEP_MS);
    }

    offset += rows.length;
    console.log(
      JSON.stringify({
        checkpoint: new Date().toISOString(),
        processed,
        updated,
        dataUrls,
        errors,
        lastBatch: rows.length,
        offset
      })
    );

    // Evita bucle infinito si alguna fila no se pudo convertir y sigue matcheando.
    if (rows.length < take) break;
  }

  console.log(
    JSON.stringify(
      {
        done: new Date().toISOString(),
        processed,
        updated,
        dataUrls,
        errors
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
