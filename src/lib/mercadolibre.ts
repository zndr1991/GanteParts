import type { MercadoLibreAccount } from "@prisma/client";
import { prisma } from "./prisma";
import { MAX_ITEM_PHOTOS, sanitizePhotosArray } from "./inventory-serialization";

const API_BASE = "https://api.mercadolibre.com";
const TOKEN_URL = `${API_BASE}/oauth/token`;

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var ${name}`);
  return value;
}

export async function getMercadoLibreAccount(userId: string) {
  return prisma.mercadoLibreAccount.findFirst({ where: { userId } });
}

export async function getMercadoLibreAccountByMlUserId(mlUserId: string) {
  return prisma.mercadoLibreAccount.findFirst({ where: { mlUserId } });
}

async function refreshToken(accountId: string, refreshTokenValue: string) {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshTokenValue,
    client_id: requiredEnv("ML_APP_ID"),
    client_secret: requiredEnv("ML_APP_SECRET")
  });

  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  const payload = await resp.json();
  if (!resp.ok) {
    const message = typeof payload?.message === "string" ? payload.message : "Refresh failed";
    throw new Error(message);
  }

  const expiresBuffer = Math.max(payload.expires_in - 60, 60);
  const expiresAt = new Date(Date.now() + expiresBuffer * 1000);

  return prisma.mercadoLibreAccount.update({
    where: { id: accountId },
    data: {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token ?? refreshTokenValue,
      scope: payload.scope ?? null,
      expiresAt
    }
  });
}

async function ensureFreshAccount(account: MercadoLibreAccount) {
  if (account.expiresAt.getTime() - Date.now() < 60_000) {
    return refreshToken(account.id, account.refreshToken);
  }
  return account;
}

export async function getValidAccessToken(userId: string) {
  const account = await getMercadoLibreAccount(userId);
  if (!account) {
    throw new Error("Cuenta de Mercado Libre no vinculada");
  }

  const fresh = await ensureFreshAccount(account);
  return fresh.accessToken;
}

export async function getValidAccessTokenByMlUserId(mlUserId: string) {
  const account = await getMercadoLibreAccountByMlUserId(mlUserId);
  if (!account) {
    throw new Error("Cuenta de Mercado Libre no vinculada");
  }

  const fresh = await ensureFreshAccount(account);
  return fresh.accessToken;
}

async function mlFetch(token: string, path: string, init?: RequestInit) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init?.headers
    }
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`ML request failed: ${response.status} ${error}`);
  }

  return response.json();
}

const HTTP_URL_REGEX = /^https?:\/\//i;
const DATA_URL_REGEX = /^data:(image\/[a-z0-9.+-]+)?;base64,([a-z0-9+/=\s]+)$/i;

const normalizeHttpUrl = (value: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed.length) return null;
  return HTTP_URL_REGEX.test(trimmed) ? trimmed : null;
};

const uniqueOrderedValues = (values: string[]) => {
  const seen = new Set<string>();
  const ordered: string[] = [];
  values.forEach((value) => {
    if (seen.has(value)) return;
    seen.add(value);
    ordered.push(value);
  });
  return ordered;
};

const resolveUploadedPictureSource = (payload: any) => {
  const candidates: unknown[] = [
    payload?.secure_url,
    payload?.url,
    payload?.display_url,
    ...(Array.isArray(payload?.variations) ? payload.variations.flatMap((entry: any) => [entry?.secure_url, entry?.url]) : [])
  ];

  for (const candidate of candidates) {
    const normalized = normalizeHttpUrl(candidate);
    if (normalized) return normalized;
  }

  return null;
};

const parseImageDataUrl = (dataUrl: string, index: number) => {
  const match = dataUrl.match(DATA_URL_REGEX);
  if (!match) {
    throw new Error(`Formato de imagen no compatible para ML en foto ${index + 1}`);
  }

  const mimeType = (match[1] || "image/jpeg").toLowerCase();
  const base64Content = match[2].replace(/\s+/g, "");
  const binary = Buffer.from(base64Content, "base64");
  if (!binary.length) {
    throw new Error(`Imagen vacia para ML en foto ${index + 1}`);
  }

  const extension = mimeType.split("/")[1] || "jpg";
  const fileName = `inventory-photo-${Date.now()}-${index + 1}.${extension}`;

  return {
    mimeType,
    binary,
    fileName
  };
};

async function uploadPictureDataUrlToMercadoLibre(token: string, dataUrl: string, index: number) {
  const parsed = parseImageDataUrl(dataUrl, index);
  const formData = new FormData();
  formData.append("file", new Blob([parsed.binary], { type: parsed.mimeType }), parsed.fileName);

  const response = await fetch(`${API_BASE}/pictures/items/upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`
    },
    body: formData
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof payload?.message === "string"
      ? payload.message
      : `Fallo al subir imagen ${index + 1} a Mercado Libre`;
    throw new Error(message);
  }

  const source = resolveUploadedPictureSource(payload);
  if (!source) {
    throw new Error(`Mercado Libre no devolvio URL para foto ${index + 1}`);
  }

  return source;
}

export const extractMercadoLibrePictureUrls = (snapshot: any, limit = MAX_ITEM_PHOTOS) => {
  const list = Array.isArray(snapshot?.pictures) ? snapshot.pictures : [];
  const sources: string[] = [];

  list.forEach((picture: any) => {
    const normalized =
      // source suele conservar la imagen original; secure_url/url pueden apuntar a variantes.
      normalizeHttpUrl(picture?.source) ||
      normalizeHttpUrl(picture?.secure_url) ||
      normalizeHttpUrl(picture?.url);
    if (normalized) {
      sources.push(normalized);
    }
  });

  return uniqueOrderedValues(sources).slice(0, limit);
};

export type SyncMercadoLibreItemPhotosResult = {
  synced: boolean;
  skipped: boolean;
  reason: string | null;
  photos: string[];
  uploadedFromDataUrl: number;
  reusedHttpSources: number;
};

export async function syncItemPhotosToMercadoLibre(params: {
  userId: string;
  itemId: string;
  localPhotos: unknown;
  limit?: number;
}): Promise<SyncMercadoLibreItemPhotosResult> {
  const limit = Math.max(1, Math.min(params.limit ?? MAX_ITEM_PHOTOS, MAX_ITEM_PHOTOS));
  const normalizedLocalPhotos = sanitizePhotosArray(params.localPhotos, limit);

  if (!normalizedLocalPhotos.length) {
    return {
      synced: false,
      skipped: true,
      reason: "No hay fotos para sincronizar con Mercado Libre",
      photos: [],
      uploadedFromDataUrl: 0,
      reusedHttpSources: 0
    };
  }

  const token = await getValidAccessToken(params.userId);
  const sourcesToSend: string[] = [];
  let uploadedFromDataUrl = 0;
  let reusedHttpSources = 0;

  for (let index = 0; index < normalizedLocalPhotos.length; index += 1) {
    const photo = normalizedLocalPhotos[index];

    const asHttp = normalizeHttpUrl(photo);
    if (asHttp) {
      sourcesToSend.push(asHttp);
      reusedHttpSources += 1;
      continue;
    }

    if (DATA_URL_REGEX.test(photo)) {
      const uploadedSource = await uploadPictureDataUrlToMercadoLibre(token, photo, index);
      sourcesToSend.push(uploadedSource);
      uploadedFromDataUrl += 1;
      continue;
    }

    throw new Error(`Formato de foto no compatible para Mercado Libre en posición ${index + 1}`);
  }

  const normalizedSources = uniqueOrderedValues(sourcesToSend).slice(0, limit);
  if (!normalizedSources.length) {
    return {
      synced: false,
      skipped: true,
      reason: "No hubo fotos válidas para sincronizar con Mercado Libre",
      photos: normalizedLocalPhotos,
      uploadedFromDataUrl,
      reusedHttpSources
    };
  }

  await mlFetch(token, `/items/${params.itemId}`, {
    method: "PUT",
    body: JSON.stringify({
      pictures: normalizedSources.map((source) => ({ source }))
    })
  });

  const refreshedSnapshot = await mlFetch(token, `/items/${params.itemId}`);
  const syncedPhotos = extractMercadoLibrePictureUrls(refreshedSnapshot, limit);

  return {
    synced: true,
    skipped: false,
    reason: null,
    photos: syncedPhotos.length ? syncedPhotos : normalizedSources,
    uploadedFromDataUrl,
    reusedHttpSources
  };
}

export async function pauseItem(userId: string, itemId: string) {
  const token = await getValidAccessToken(userId);
  await mlFetch(token, `/items/${itemId}`, {
    method: "PUT",
    body: JSON.stringify({ status: "paused" })
  });
}

export async function activateItem(userId: string, itemId: string) {
  const token = await getValidAccessToken(userId);
  await mlFetch(token, `/items/${itemId}`, {
    method: "PUT",
    body: JSON.stringify({ status: "active" })
  });
}

export async function updateStock(userId: string, itemId: string, availableQuantity: number) {
  const token = await getValidAccessToken(userId);
  await mlFetch(token, `/items/${itemId}`, {
    method: "PUT",
    body: JSON.stringify({ available_quantity: availableQuantity })
  });
}

export async function fetchItemSnapshotByMlUserId(mlUserId: string, itemId: string) {
  const token = await getValidAccessTokenByMlUserId(mlUserId);
  return mlFetch(token, `/items/${itemId}`);
}
