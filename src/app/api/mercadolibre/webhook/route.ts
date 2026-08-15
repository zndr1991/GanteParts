export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { createHmac, timingSafeEqual } from "crypto";
import { revalidateTag } from "next/cache";

import { extractMercadoLibrePictureUrls, fetchItemSnapshotByMlUserId, getMercadoLibreAccountByMlUserId } from "@/lib/mercadolibre";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

const STATUS_MAPPING: Record<string, string> = {
  active: "active",
  paused: "paused",
  closed: "inactive",
  inactive: "inactive",
  not_yet_active: "inactive",
  under_review: "inactive",
  payment_required: "inactive"
};

const INTERNAL_STATUS_PAUSED_BY_ML = "PAUSADO POR MERCADO LIBRE";
const INTERNAL_STATUS_ACTIVE_ML = "ML";
const ML_APP_STATUS_SYNC_AT_KEY = "ml_app_status_sync_at";
const ML_APP_STATUS_SYNC_TO_KEY = "ml_app_status_sync_to";
const ML_APP_STATUS_SYNC_SOURCE_KEY = "ml_app_status_sync_source";
const APP_STATUS_SYNC_GUARD_MS = 30 * 60 * 1000;
const INTERNAL_STATUS_PRESERVED_ON_ML_PAUSE = new Set(["PRESTADO", "VENDIDO", "SIN SUBIR"]);

const SUPPORTED_TOPICS = new Set(["items"]);

function verifySignature(params: { signatureHeader: string; secret: string; rawBody: string }) {
  const { signatureHeader, secret, rawBody } = params;
  if (!secret) return true;
  if (!signatureHeader) return false;
  if (signatureHeader === secret) return true;

  const match = signatureHeader.match(/ts=([^,]+),v1=([a-f0-9]+)/i);
  const matchAny = signatureHeader.match(/ts=([^,]+),v1=([^,]+)/i);
  if (!matchAny) return false;
  const [, ts, signature] = matchAny;
  const payload = `${ts}.${rawBody}`;
  const digestHex = createHmac("sha256", secret).update(payload).digest("hex");
  const digestBase64 = createHmac("sha256", secret).update(payload).digest("base64");
  const normalizedSignature = signature.trim();
  if (digestHex.length === normalizedSignature.length) {
    try {
      return timingSafeEqual(Buffer.from(digestHex, "utf8"), Buffer.from(normalizedSignature, "utf8"));
    } catch {
      return false;
    }
  }
  if (digestBase64.length === normalizedSignature.length) {
    try {
      return timingSafeEqual(Buffer.from(digestBase64, "utf8"), Buffer.from(normalizedSignature, "utf8"));
    } catch {
      return false;
    }
  }
  return false;
}

function verifySignatureFallback(params: { signatureHeader: string; secret: string; rawBody: string }) {
  const { signatureHeader, secret, rawBody } = params;
  if (!secret) return true;
  if (!signatureHeader) return false;
  const hex = signatureHeader.replace(/^v1=|^sha256=/i, "").trim();
  const digestHex = createHmac("sha256", secret).update(rawBody).digest("hex");
  const digestBase64 = createHmac("sha256", secret).update(rawBody).digest("base64");
  if (/^[a-f0-9]+$/i.test(hex) && digestHex.length === hex.length) {
    try {
      return timingSafeEqual(Buffer.from(digestHex, "utf8"), Buffer.from(hex, "utf8"));
    } catch {
      return false;
    }
  }
  if (digestBase64.length === hex.length) {
    try {
      return timingSafeEqual(Buffer.from(digestBase64, "utf8"), Buffer.from(hex, "utf8"));
    } catch {
      return false;
    }
  }
  return false;
}

function extractItemId(resource?: string | null) {
  if (!resource) return null;
  const clean = resource.split("?")[0];
  const segments = clean.split("/").map((segment) => segment.trim()).filter(Boolean);
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const segment = segments[i].toUpperCase();
    if (segment.startsWith("ML") && /\d/.test(segment)) {
      return segment;
    }
  }
  return null;
}

function mapStatus(status?: string | null) {
  if (!status) return "inactive";
  const normalized = status.toLowerCase();
  return STATUS_MAPPING[normalized] ?? "inactive";
}

function normalizeInternalStatus(value: unknown) {
  const raw = (value ?? "").toString().trim().toUpperCase();
  return raw.length ? raw : "SIN ESTATUS";
}

function toFiniteNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function toStringArray(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return value
    .map((entry) => (entry ?? "").toString().trim().toLowerCase())
    .filter((entry) => entry.length);
}

function setExtraField(extra: Record<string, any>, key: string, value: unknown) {
  if (value === null || value === undefined || value === "") {
    delete extra[key];
    return;
  }
  extra[key] = value;
}

function getAppPauseGuardState(extra: Record<string, any>, nextStatus: string) {
  const guardTo = (extra[ML_APP_STATUS_SYNC_TO_KEY] ?? "").toString().trim().toLowerCase();
  const guardAtRaw = (extra[ML_APP_STATUS_SYNC_AT_KEY] ?? "").toString().trim();
  const guardSourceRaw = (extra[ML_APP_STATUS_SYNC_SOURCE_KEY] ?? "").toString().trim();

  const guardSource = guardSourceRaw.length ? guardSourceRaw : null;

  if (nextStatus !== "paused" && nextStatus !== "inactive") {
    return { active: false, expired: false, source: guardSource };
  }

  if (guardTo !== "paused" && guardTo !== "inactive") {
    return { active: false, expired: false, source: guardSource };
  }

  const parsedAt = Date.parse(guardAtRaw);
  if (!Number.isFinite(parsedAt)) {
    return { active: false, expired: false, source: guardSource };
  }

  const ageMs = Date.now() - parsedAt;
  if (!Number.isFinite(ageMs) || ageMs < 0) {
    return { active: false, expired: false, source: guardSource };
  }

  const expired = ageMs > APP_STATUS_SYNC_GUARD_MS;
  return { active: !expired, expired, source: guardSource };
}

function resolveInternalStatusFromMercadoLibre(params: {
  nextStatus: string;
  currentInternalStatus: string;
  preserveOnPause: boolean;
}) {
  const { nextStatus, currentInternalStatus, preserveOnPause } = params;

  if (nextStatus === "active") {
    if (currentInternalStatus === INTERNAL_STATUS_PAUSED_BY_ML) {
      return INTERNAL_STATUS_ACTIVE_ML;
    }
    return null;
  }

  if (nextStatus === "paused" || nextStatus === "inactive") {
    if (preserveOnPause) {
      return null;
    }
    if (currentInternalStatus !== INTERNAL_STATUS_PAUSED_BY_ML) {
      return INTERNAL_STATUS_PAUSED_BY_ML;
    }
  }

  return null;
}

function toExtraDataObject(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, any>;
  }
  return { ...(value as Record<string, any>) };
}

function areStringArraysEqual(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  let payload: any = null;
  if (rawBody) {
    try {
      payload = JSON.parse(rawBody);
    } catch {
      payload = null;
    }
  }
  const signatureHeader =
    req.headers.get("x-ml-signature") ||
    req.headers.get("x-meli-signature") ||
    req.headers.get("x-meli-signature-v1") ||
    req.headers.get("x-hub-signature") ||
    req.headers.get("x-hub-signature-256") ||
    "";
  const secret = process.env.ML_WEBHOOK_SECRET || "";

  if (!verifySignature({ signatureHeader, secret, rawBody }) && !verifySignatureFallback({ signatureHeader, secret, rawBody })) {
    const signatureHeaders: Record<string, string> = {};
    req.headers.forEach((value, key) => {
      if (key.toLowerCase().includes("signature")) {
        signatureHeaders[key] = `${value.slice(0, 16)}...`;
      }
    });
    const resource = typeof payload?.resource === "string" ? payload.resource : "";
    const fallbackItemId = extractItemId(resource);
    const fallbackItem = fallbackItemId
      ? await prisma.inventoryItem.findFirst({
          where: {
            mlItemId: {
              equals: fallbackItemId,
              mode: "insensitive"
            }
          },
          select: { ownerId: true }
        })
      : null;

    await prisma.auditLog.create({
      data: {
        action: "ml:webhook",
        userId: fallbackItem?.ownerId ?? null,
        metadata: {
          payload,
          reason: "signature_invalid",
          error: "Firma webhook invalida",
          signatureHeaders
        }
      }
    });
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const safePayload = payload ?? null;
  if (!safePayload) {
    await prisma.auditLog.create({
      data: {
        action: "ml:webhook",
        metadata: { error: "payload_invalid" }
      }
    });
    return NextResponse.json({ ok: true });
  }
  if (!payload) {
    await prisma.auditLog.create({
      data: { action: "ml:webhook", metadata: { error: "payload_invalid" } }
    });
    return NextResponse.json({ ok: true });
  }

  const topic = typeof safePayload.topic === "string" ? safePayload.topic : "";
  const resource = typeof safePayload.resource === "string" ? safePayload.resource : "";
  const mlUserId = safePayload.user_id !== undefined && safePayload.user_id !== null ? String(safePayload.user_id) : "";

  if (!SUPPORTED_TOPICS.has(topic) || !resource || !mlUserId) {
    await prisma.auditLog.create({
      data: {
        action: "ml:webhook",
        metadata: { payload: safePayload, reason: "ignored", topic, resource, mlUserId }
      }
    });
    return NextResponse.json({ ok: true });
  }

  const itemId = extractItemId(resource);
  if (!itemId) {
    await prisma.auditLog.create({
      data: {
        action: "ml:webhook",
        metadata: { payload: safePayload, reason: "no_item_id", resource }
      }
    });
    return NextResponse.json({ ok: true });
  }

  const account = await getMercadoLibreAccountByMlUserId(mlUserId);
  if (!account) {
    const fallbackItem = await prisma.inventoryItem.findFirst({
      where: {
        mlItemId: {
          equals: itemId,
          mode: "insensitive"
        }
      },
      select: { ownerId: true }
    });
    await prisma.auditLog.create({
      data: {
        action: "ml:webhook",
        userId: fallbackItem?.ownerId ?? null,
        metadata: {
          payload: safePayload,
          reason: "account_not_found",
          error: "Cuenta de Mercado Libre no vinculada",
          mlUserId,
          itemId
        }
      }
    });
    return NextResponse.json({ ok: true });
  }

  const linkedAccounts = await prisma.mercadoLibreAccount.findMany({
    where: { mlUserId },
    select: { userId: true }
  });
  const linkedOwnerIds = Array.from(new Set(linkedAccounts.map((entry) => entry.userId).filter(Boolean)));

  try {
    const snapshot = await fetchItemSnapshotByMlUserId(mlUserId, itemId);
    const nextStatus = mapStatus(snapshot?.status);
    const nextStock = typeof snapshot?.available_quantity === "number" ? snapshot.available_quantity : null;
    const nextPhotos = extractMercadoLibrePictureUrls(snapshot);

    let matchScope: "linked-owners" | "global-fallback" = "linked-owners";

    let matchedItems = await prisma.inventoryItem.findMany({
      where: {
        mlItemId: {
          equals: itemId,
          mode: "insensitive"
        },
        ownerId: {
          in: linkedOwnerIds.length ? linkedOwnerIds : [account.userId]
        }
      },
      select: {
        id: true,
        status: true,
        stock: true,
        extraData: true
      }
    });

    if (!matchedItems.length) {
      matchScope = "global-fallback";
      matchedItems = await prisma.inventoryItem.findMany({
        where: {
          mlItemId: {
            equals: itemId,
            mode: "insensitive"
          }
        },
        select: {
          id: true,
          status: true,
          stock: true,
          extraData: true
        }
      });
    }

    let updatedCount = 0;
    let photosUpdatedCount = 0;
    let internalStatusUpdatedCount = 0;
    let soldByMlCount = 0;
    let appPauseGuardAppliedCount = 0;
    const statusReasonTotals: Record<string, number> = {};

    for (const matched of matchedItems) {
      const nextExtra = toExtraDataObject(matched.extraData);
      const currentPhotos = Array.isArray(nextExtra.photos)
        ? nextExtra.photos.map((entry: unknown) => (typeof entry === "string" ? entry.trim() : "")).filter((entry: string) => entry.length)
        : [];

      const photosChanged = !areStringArraysEqual(currentPhotos, nextPhotos);
      const statusChanged = matched.status !== nextStatus;
      const stockChanged = typeof nextStock === "number" && matched.stock !== nextStock;
      const rawSnapshotStatus = typeof snapshot?.status === "string" ? snapshot.status.toLowerCase() : null;
      const subStatuses = toStringArray(snapshot?.sub_status);
      const soldQuantity = toFiniteNumber(snapshot?.sold_quantity);
      const availableQuantity = toFiniteNumber(snapshot?.available_quantity);
      const previousSoldQuantity = toFiniteNumber(nextExtra.ml_sold_quantity);
      const previousAvailableQuantity = toFiniteNumber(nextExtra.ml_available_quantity);
      const soldIncreased =
        soldQuantity !== null && (previousSoldQuantity === null ? soldQuantity > 0 : soldQuantity > previousSoldQuantity);
      const soldOutHint = subStatuses.includes("out_of_stock") || (availableQuantity !== null && availableQuantity <= 0);
      const soldByMl =
        soldIncreased ||
        ((rawSnapshotStatus === "closed" || rawSnapshotStatus === "inactive") &&
          soldQuantity !== null &&
          soldQuantity > 0 &&
          soldOutHint);

      const appPauseGuard = getAppPauseGuardState(nextExtra, nextStatus);
      const preserveByBusinessStatus = INTERNAL_STATUS_PRESERVED_ON_ML_PAUSE.has(
        normalizeInternalStatus(nextExtra.estatus_interno)
      );

      let mlStatusReason = "active";
      let mlStatusReasonLabel: string | null = null;
      if (nextStatus === "paused" || nextStatus === "inactive") {
        if (soldByMl) {
          mlStatusReason = "sold_ml";
          mlStatusReasonLabel = "Vendido en Mercado Libre";
        } else if (preserveByBusinessStatus || appPauseGuard.active) {
          mlStatusReason = "app_pause_sync";
          mlStatusReasonLabel = preserveByBusinessStatus
            ? "Pausa por estatus interno en la app"
            : "Pausa enviada desde la app";
        } else if (nextStatus === "paused") {
          mlStatusReason = "paused_ml";
          mlStatusReasonLabel = "Pausado directamente en Mercado Libre";
        } else {
          mlStatusReason = "inactive_ml_other";
          mlStatusReasonLabel = "Inactivo en Mercado Libre (no venta)";
        }
      }

      const previousReason = (nextExtra.ml_status_reason ?? "").toString().trim().toLowerCase() || null;
      const previousReasonLabel = (nextExtra.ml_status_reason_label ?? "").toString().trim() || null;
      const nextSubStatusValue = subStatuses.length ? subStatuses.join(",") : null;
      const previousSubStatusValue = (nextExtra.ml_status_sub_status ?? "").toString().trim() || null;
      const hasAppPauseMarker =
        (nextExtra[ML_APP_STATUS_SYNC_AT_KEY] ?? "").toString().trim().length > 0 ||
        (nextExtra[ML_APP_STATUS_SYNC_TO_KEY] ?? "").toString().trim().length > 0 ||
        (nextExtra[ML_APP_STATUS_SYNC_SOURCE_KEY] ?? "").toString().trim().length > 0;
      const shouldClearAppPauseMarker =
        hasAppPauseMarker && (nextStatus === "active" || appPauseGuard.expired || mlStatusReason === "sold_ml");
      const reasonMetadataChanged =
        previousReason !== mlStatusReason ||
        previousReasonLabel !== mlStatusReasonLabel ||
        previousSoldQuantity !== soldQuantity ||
        previousAvailableQuantity !== availableQuantity ||
        previousSubStatusValue !== nextSubStatusValue ||
        shouldClearAppPauseMarker;

      const currentInternalStatus = normalizeInternalStatus(nextExtra.estatus_interno);
      const nextInternalStatus = resolveInternalStatusFromMercadoLibre({
        nextStatus,
        currentInternalStatus,
        preserveOnPause:
          preserveByBusinessStatus || (appPauseGuard.active && mlStatusReason === "app_pause_sync")
      });
      const internalStatusChanged = typeof nextInternalStatus === "string";

      if (!photosChanged && !statusChanged && !stockChanged && !internalStatusChanged && !reasonMetadataChanged) {
        continue;
      }

      if (photosChanged) {
        if (nextPhotos.length) {
          nextExtra.photos = nextPhotos;
        } else {
          delete nextExtra.photos;
        }
        photosUpdatedCount += 1;
      }

      if (internalStatusChanged) {
        nextExtra.estatus_interno = nextInternalStatus;
        internalStatusUpdatedCount += 1;
      }

      setExtraField(nextExtra, "ml_status_reason", mlStatusReason);
      setExtraField(nextExtra, "ml_status_reason_label", mlStatusReasonLabel);
      setExtraField(nextExtra, "ml_status_sub_status", nextSubStatusValue);
      setExtraField(nextExtra, "ml_status_raw", rawSnapshotStatus);
      setExtraField(nextExtra, "ml_sold_quantity", soldQuantity);
      setExtraField(nextExtra, "ml_available_quantity", availableQuantity);
      nextExtra.ml_status_synced_at = new Date().toISOString();

      if (shouldClearAppPauseMarker) {
        delete nextExtra[ML_APP_STATUS_SYNC_AT_KEY];
        delete nextExtra[ML_APP_STATUS_SYNC_TO_KEY];
        delete nextExtra[ML_APP_STATUS_SYNC_SOURCE_KEY];
      }

      if (soldByMl) {
        soldByMlCount += 1;
      }
      if (appPauseGuard.active && mlStatusReason === "app_pause_sync") {
        appPauseGuardAppliedCount += 1;
      }
      statusReasonTotals[mlStatusReason] = (statusReasonTotals[mlStatusReason] ?? 0) + 1;

      nextExtra.ml_fotos_sync_at = new Date().toISOString();
      nextExtra.ml_fotos_sync_estado = "ok";
      nextExtra.ml_fotos_sync_mensaje = "Sincronizado desde Mercado Libre";

      await prisma.inventoryItem.update({
        where: { id: matched.id },
        data: {
          status: statusChanged ? nextStatus : undefined,
          stock: stockChanged && typeof nextStock === "number" ? nextStock : undefined,
          extraData: nextExtra
        }
      });

      updatedCount += 1;
    }

    await prisma.auditLog.create({
      data: {
        action: "ml:webhook",
        userId: account.userId,
        metadata: {
          payload: safePayload,
          itemId,
          status: snapshot?.status ?? null,
          mappedStatus: nextStatus,
          linkedOwnerIds,
          linkedOwnerCount: linkedOwnerIds.length,
          matchedCount: matchedItems.length,
          matchScope,
          stock: nextStock,
          photosDetected: nextPhotos.length,
          photosUpdated: photosUpdatedCount,
          internalStatusUpdated: internalStatusUpdatedCount,
          soldByMlCount,
          appPauseGuardAppliedCount,
          statusReasonTotals,
          updated: updatedCount
        }
      }
    });

    if (updatedCount > 0) {
      revalidateTag("inventory-initial");
    }

    return NextResponse.json({
      ok: true,
      updated: updatedCount,
      photosUpdated: photosUpdatedCount,
      internalStatusUpdated: internalStatusUpdatedCount,
      soldByMlCount,
      appPauseGuardAppliedCount,
      statusReasonTotals
    });
  } catch (error: any) {
    await prisma.auditLog.create({
      data: {
        action: "ml:webhook",
        userId: account.userId,
        metadata: {
          payload: safePayload,
          itemId,
          error: error?.message ?? "unknown"
        }
      }
    });
    return NextResponse.json({ ok: false });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, message: "Webhook activo" });
}
