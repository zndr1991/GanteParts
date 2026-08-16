import { createHash } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";

import { MAX_ITEM_PHOTOS } from "./inventory-serialization";

const UPLOAD_ROOT = path.join(process.cwd(), "public", "uploads", "inventory");
const LOCAL_UPLOAD_PREFIX = "/uploads/inventory/";
const DATA_URL_REGEX = /^data:(image\/[a-z0-9.+-]+)?;base64,([a-z0-9+/=\s]+)$/i;

const ensureDir = async (dirPath: string) => {
  await mkdir(dirPath, { recursive: true });
};

const extensionFromMime = (mimeType: string) => {
  const normalized = (mimeType || "").toLowerCase();
  if (normalized.includes("png")) return "png";
  if (normalized.includes("webp")) return "webp";
  if (normalized.includes("gif")) return "gif";
  if (normalized.includes("bmp")) return "bmp";
  if (normalized.includes("avif")) return "avif";
  return "jpg";
};

const parseDataUrl = (value: string) => {
  const match = value.trim().match(DATA_URL_REGEX);
  if (!match) return null;
  return {
    mimeType: match[1] || "image/jpeg",
    buffer: Buffer.from(match[2].replace(/\s+/g, ""), "base64")
  };
};

const isHttpUrl = (value: string) => /^https?:\/\//i.test(value);

const normalizeLocalUploadPath = (value: string): string | null => {
  const trimmed = (value ?? "").toString().trim();
  if (!trimmed.startsWith(LOCAL_UPLOAD_PREFIX)) return null;

  const normalized = path.posix.normalize(trimmed);
  if (!normalized.startsWith(LOCAL_UPLOAD_PREFIX)) return null;

  return normalized;
};

const parseLocalUploadPathFromProxy = (value: string): string | null => {
  const trimmed = (value ?? "").toString().trim();
  if (!trimmed.length) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed, "http://local");
  } catch {
    return null;
  }

  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts.length !== 5) return null;
  if (parts[0] !== "api" || parts[1] !== "inventory" || parts[3] !== "photos" || parts[4] !== "file") {
    return null;
  }

  const itemId = (parts[2] ?? "").toString().trim();
  const src = (parsed.searchParams.get("src") ?? "").toString().trim();
  if (!src.length) return null;

  const normalizedSource = normalizeLocalUploadPath(src);
  if (!normalizedSource) return null;
  if (itemId.length && !normalizedSource.includes(`/${itemId}/`)) return null;

  return normalizedSource;
};

export const normalizeInventoryPhotoSource = (value: string): string => {
  const trimmed = (value ?? "").toString().trim();
  if (!trimmed.length) return "";

  const local = normalizeLocalUploadPath(trimmed);
  if (local) return local;

  const fromProxy = parseLocalUploadPathFromProxy(trimmed);
  if (fromProxy) return fromProxy;

  return trimmed;
};

export const isInventoryLocalUploadPath = (value: string): boolean => {
  const normalized = normalizeInventoryPhotoSource(value);
  return Boolean(normalizeLocalUploadPath(normalized));
};

export const toInventoryPhotoClientSrc = (itemId: string, value: string): string => {
  const normalized = normalizeInventoryPhotoSource(value);
  const localPath = normalizeLocalUploadPath(normalized);
  if (!localPath) return normalized;

  const safeItemId = (itemId ?? "").toString().trim();
  if (!safeItemId.length || !localPath.includes(`/${safeItemId}/`)) {
    return localPath;
  }

  return `/api/inventory/${encodeURIComponent(safeItemId)}/photos/file?src=${encodeURIComponent(localPath)}`;
};

export const resolveInventoryLocalUploadAbsolutePath = (itemId: string, value: string): string | null => {
  const normalized = normalizeInventoryPhotoSource(value);
  const localPath = normalizeLocalUploadPath(normalized);
  if (!localPath) return null;

  const safeItemId = (itemId ?? "").toString().trim();
  if (safeItemId.length && !localPath.includes(`/${safeItemId}/`)) return null;

  const absolutePath = path.join(process.cwd(), "public", localPath.replace(/^\/+/, ""));
  const relativeToUploads = path.relative(UPLOAD_ROOT, absolutePath);

  if (relativeToUploads.startsWith("..") || path.isAbsolute(relativeToUploads)) {
    return null;
  }

  return absolutePath;
};

/**
 * Convierte fotos data-url a archivos locales y conserva URLs/http existentes.
 * No modifica estructura de BD, solo reemplaza referencias en extraData.photos.
 */
export async function materializeInventoryPhotos(
  itemId: string,
  photos: string[],
  options?: { limit?: number }
): Promise<string[]> {
  const limit = Math.max(1, Math.min(options?.limit ?? MAX_ITEM_PHOTOS, MAX_ITEM_PHOTOS));
  const normalized = Array.from(
    new Set(
      (Array.isArray(photos) ? photos : [])
        .map((entry) => (typeof entry === "string" ? normalizeInventoryPhotoSource(entry) : ""))
        .filter((entry) => entry.length)
    )
  ).slice(0, limit);

  if (!normalized.length) return [];

  const itemDir = path.join(UPLOAD_ROOT, itemId);
  await ensureDir(itemDir);

  const result: string[] = [];
  for (let index = 0; index < normalized.length; index += 1) {
    const photo = normalized[index];

    if (isHttpUrl(photo) || isInventoryLocalUploadPath(photo)) {
      const localPath = normalizeLocalUploadPath(photo);
      result.push(localPath ?? photo);
      continue;
    }

    const parsed = parseDataUrl(photo);
    if (!parsed || !parsed.buffer.length) {
      result.push(photo);
      continue;
    }

    const digest = createHash("sha1").update(parsed.buffer).digest("hex").slice(0, 12);
    const ext = extensionFromMime(parsed.mimeType);
    const fileName = `${String(index + 1).padStart(2, "0")}-${digest}.${ext}`;
    const absPath = path.join(itemDir, fileName);

    await writeFile(absPath, parsed.buffer);
    result.push(`/uploads/inventory/${itemId}/${fileName}`);
  }

  return result;
}
