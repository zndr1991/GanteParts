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

  try {
    const snapshot = await fetchItemSnapshotByMlUserId(mlUserId, itemId);
    const nextStatus = mapStatus(snapshot?.status);
    const nextStock = typeof snapshot?.available_quantity === "number" ? snapshot.available_quantity : null;
    const nextPhotos = extractMercadoLibrePictureUrls(snapshot);

    const matchedItems = await prisma.inventoryItem.findMany({
      where: { mlItemId: itemId, ownerId: account.userId },
      select: {
        id: true,
        status: true,
        stock: true,
        extraData: true
      }
    });

    let updatedCount = 0;
    let photosUpdatedCount = 0;

    for (const matched of matchedItems) {
      const nextExtra = toExtraDataObject(matched.extraData);
      const currentPhotos = Array.isArray(nextExtra.photos)
        ? nextExtra.photos.map((entry: unknown) => (typeof entry === "string" ? entry.trim() : "")).filter((entry: string) => entry.length)
        : [];

      const photosChanged = !areStringArraysEqual(currentPhotos, nextPhotos);
      const statusChanged = matched.status !== nextStatus;
      const stockChanged = typeof nextStock === "number" && matched.stock !== nextStock;

      if (!photosChanged && !statusChanged && !stockChanged) {
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
          stock: nextStock,
          photosDetected: nextPhotos.length,
          photosUpdated: photosUpdatedCount,
          updated: updatedCount
        }
      }
    });

    if (updatedCount > 0) {
      revalidateTag("inventory-initial");
    }

    return NextResponse.json({ ok: true, updated: updatedCount, photosUpdated: photosUpdatedCount });
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
