export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { activateItem, getMercadoLibreAccount, pauseItem } from "@/lib/mercadolibre";

const ML_APP_STATUS_SYNC_AT_KEY = "ml_app_status_sync_at";
const ML_APP_STATUS_SYNC_TO_KEY = "ml_app_status_sync_to";
const ML_APP_STATUS_SYNC_SOURCE_KEY = "ml_app_status_sync_source";

const toExtraDataObject = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, any>;
  }
  return { ...(value as Record<string, any>) };
};

const actionSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
  action: z.enum(["pause", "activate"])
});

const canManageMercadoLibre = (role?: string | null) => {
  const normalized = (role ?? "").toLowerCase();
  return normalized === "admin" || normalized === "operator" || normalized === "supervisor";
};

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!canManageMercadoLibre(session.user.role)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const linkedAccount = await getMercadoLibreAccount(session.user.id);
  if (!linkedAccount) {
    return NextResponse.json(
      {
        error: "Tu usuario no tiene cuenta de Mercado Libre vinculada. Vinculala desde Gestion de usuarios."
      },
      { status: 409 }
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload invalido" }, { status: 400 });
  }

  const { ids, action } = parsed.data;

  const role = (session.user.role ?? "").toLowerCase();
  const where = role === "viewer" ? { id: { in: ids }, ownerId: session.user.id } : { id: { in: ids } };

  const items = await prisma.inventoryItem.findMany({
    where
  });

  if (!items.length) {
    return NextResponse.json({ error: "Items no encontrados" }, { status: 404 });
  }

  const failed: Array<{ id: string; reason: string }> = [];
  let successCount = 0;

  for (const item of items) {
    if (!item.mlItemId) {
      failed.push({ id: item.id, reason: "Sin codigo de Mercado Libre" });
      continue;
    }

    try {
      if (action === "pause") {
        await pauseItem(session.user.id, item.mlItemId);
        const nextExtra = toExtraDataObject(item.extraData);
        nextExtra[ML_APP_STATUS_SYNC_AT_KEY] = new Date().toISOString();
        nextExtra[ML_APP_STATUS_SYNC_TO_KEY] = "paused";
        nextExtra[ML_APP_STATUS_SYNC_SOURCE_KEY] = "APP_BULK_ML_PAUSE";
        await prisma.inventoryItem.update({
          where: { id: item.id },
          data: { status: "paused", extraData: nextExtra }
        });
      } else if (action === "activate") {
        await activateItem(session.user.id, item.mlItemId);
        const nextExtra = toExtraDataObject(item.extraData);
        delete nextExtra[ML_APP_STATUS_SYNC_AT_KEY];
        delete nextExtra[ML_APP_STATUS_SYNC_TO_KEY];
        delete nextExtra[ML_APP_STATUS_SYNC_SOURCE_KEY];
        await prisma.inventoryItem.update({
          where: { id: item.id },
          data: { status: "active", extraData: nextExtra }
        });
      }
      successCount += 1;
    } catch (error: any) {
      failed.push({ id: item.id, reason: error?.message ?? "Error desconocido" });
    }
  }

  await prisma.auditLog.create({
    data: {
      action: `ml:${action}`,
      userId: session.user.id,
      metadata: {
        requestedIds: ids,
        successCount,
        failed
      }
    }
  });

  if (!successCount) {
    return NextResponse.json({ error: "No se pudo completar la accion", failed }, { status: 502 });
  }

  return NextResponse.json({ ok: true, successCount, failed, partial: failed.length > 0 }, { status: 200 });
}
