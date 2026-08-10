export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { MAX_ITEM_PHOTOS, sanitizePhotosArray } from "@/lib/inventory-serialization";
import { syncItemPhotosToMercadoLibre } from "@/lib/mercadolibre";
import { prisma } from "@/lib/prisma";

const payloadSchema = z.object({
  cursor: z.string().trim().min(1).optional(),
  batchSize: z.number().int().min(1).max(50).optional(),
  retryCount: z.number().int().min(0).max(3).optional()
});

const DEFAULT_BATCH_SIZE = 15;
const DEFAULT_RETRY_COUNT = 2;

const canManageUsers = (role?: string | null) => (role ?? "").toLowerCase() === "admin";

const buildWhere = (cursor?: string): Prisma.InventoryItemWhereInput => {
  const andFilters: Prisma.InventoryItemWhereInput[] = [{ mlItemId: { not: null } }, { mlItemId: { not: "" } }];
  if (cursor) {
    andFilters.push({ id: { gt: cursor } });
  }

  return {
    AND: andFilters
  };
};

const toExtraRecord = (value: Prisma.JsonValue | null): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return { ...(value as Record<string, unknown>) };
};

const buildSyncMessage = (prefix: string, detail?: string | null) => {
  const normalizedDetail = (detail ?? "").trim();
  return normalizedDetail.length ? `${prefix}: ${normalizedDetail}` : prefix;
};

async function persistItemSyncState(params: {
  itemId: string;
  extra: Record<string, unknown>;
  state: "ok" | "warning" | "error";
  message?: string | null;
  photos?: string[];
}) {
  const nextExtra = { ...params.extra };
  nextExtra.ml_fotos_sync_at = new Date().toISOString();
  nextExtra.ml_fotos_sync_estado = params.state;

  if (params.message && params.message.trim().length) {
    nextExtra.ml_fotos_sync_mensaje = params.message.trim();
  } else {
    delete nextExtra.ml_fotos_sync_mensaje;
  }

  if (params.photos) {
    if (params.photos.length) {
      nextExtra.photos = params.photos;
    } else {
      delete nextExtra.photos;
    }
  }

  await prisma.inventoryItem.update({
    where: { id: params.itemId },
    data: {
      extraData: nextExtra as Prisma.InputJsonValue
    }
  });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  if (!canManageUsers(session.user.role)) {
    return NextResponse.json({ error: "Sin permisos para resincronizacion" }, { status: 403 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const parsed = payloadSchema.parse(body);
    const cursor = parsed.cursor;
    const batchSize = parsed.batchSize ?? DEFAULT_BATCH_SIZE;
    const retryCount = parsed.retryCount ?? DEFAULT_RETRY_COUNT;
    const maxAttempts = retryCount + 1;

    const rows = await prisma.inventoryItem.findMany({
      where: buildWhere(cursor),
      orderBy: { id: "asc" },
      take: batchSize,
      select: {
        id: true,
        ownerId: true,
        mlItemId: true,
        extraData: true
      }
    });

    if (!rows.length) {
      return NextResponse.json({
        ok: true,
        hasMore: false,
        nextCursor: null,
        batch: {
          processed: 0,
          syncedOk: 0,
          warnings: 0,
          errors: 0,
          skippedNoMlItemId: 0,
          skippedNoPhotos: 0,
          skippedMissingAccount: 0,
          retriedItems: 0,
          retryAttemptsUsed: 0
        },
        reasons: [] as Array<{ reason: string; count: number }>
      });
    }

    const ownerIds = Array.from(new Set(rows.map((row) => row.ownerId)));
    const linkedAccounts = await prisma.mercadoLibreAccount.findMany({
      where: { userId: { in: ownerIds } },
      select: { userId: true }
    });
    const linkedOwnerIds = new Set(linkedAccounts.map((entry) => entry.userId));

    const reasonCounter = new Map<string, number>();
    const addReason = (reason: string) => {
      reasonCounter.set(reason, (reasonCounter.get(reason) ?? 0) + 1);
    };

    const batchStats = {
      processed: 0,
      syncedOk: 0,
      warnings: 0,
      errors: 0,
      skippedNoMlItemId: 0,
      skippedNoPhotos: 0,
      skippedMissingAccount: 0,
      retriedItems: 0,
      retryAttemptsUsed: 0
    };

    for (const row of rows) {
      batchStats.processed += 1;
      const extra = toExtraRecord(row.extraData);
      const normalizedMlItemId = (row.mlItemId ?? "").trim().toUpperCase();

      if (!normalizedMlItemId) {
        const warningMessage = "Sin codigo de Mercado Libre";
        batchStats.warnings += 1;
        batchStats.skippedNoMlItemId += 1;
        addReason(warningMessage);
        await persistItemSyncState({
          itemId: row.id,
          extra,
          state: "warning",
          message: warningMessage
        });
        continue;
      }

      if (!linkedOwnerIds.has(row.ownerId)) {
        const errorMessage = buildSyncMessage("Fotos ML", "Cuenta de Mercado Libre no vinculada");
        batchStats.errors += 1;
        batchStats.skippedMissingAccount += 1;
        addReason(errorMessage);
        await persistItemSyncState({
          itemId: row.id,
          extra,
          state: "error",
          message: errorMessage
        });
        continue;
      }

      const localPhotos = sanitizePhotosArray(extra.photos, MAX_ITEM_PHOTOS);
      let syncResult: Awaited<ReturnType<typeof syncItemPhotosToMercadoLibre>> | null = null;
      let syncErrorMessage: string | null = null;
      let attemptsUsed = 0;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        attemptsUsed = attempt;
        try {
          syncResult = await syncItemPhotosToMercadoLibre({
            userId: row.ownerId,
            itemId: normalizedMlItemId,
            localPhotos,
            limit: MAX_ITEM_PHOTOS
          });
          break;
        } catch (error: any) {
          syncErrorMessage = error?.message ?? "No se pudo sincronizar fotos con Mercado Libre";
          if (attempt >= maxAttempts) {
            break;
          }
        }
      }

      if (attemptsUsed > 1) {
        batchStats.retriedItems += 1;
        batchStats.retryAttemptsUsed += attemptsUsed - 1;
      }

      if (syncResult) {
        if (syncResult.synced) {
          batchStats.syncedOk += 1;
        }

        if (syncResult.skipped) {
          const warningMessage = syncResult.reason || "Sync omitido";
          batchStats.warnings += 1;
          if (warningMessage.toLowerCase().includes("no hay fotos")) {
            batchStats.skippedNoPhotos += 1;
          }
          addReason(warningMessage);
          await persistItemSyncState({
            itemId: row.id,
            extra,
            state: "warning",
            message: warningMessage,
            photos: syncResult.photos
          });
        } else {
          await persistItemSyncState({
            itemId: row.id,
            extra,
            state: "ok",
            photos: syncResult.photos
          });
        }

        continue;
      }

      const finalErrorMessage = buildSyncMessage(
        "Fotos ML",
        syncErrorMessage || "No se pudo sincronizar fotos con Mercado Libre"
      );
      batchStats.errors += 1;
      addReason(finalErrorMessage);
      await persistItemSyncState({
        itemId: row.id,
        extra,
        state: "error",
        message: finalErrorMessage
      });
    }

    const lastRowId = rows[rows.length - 1]?.id ?? null;
    let hasMore = false;
    if (lastRowId) {
      const nextRow = await prisma.inventoryItem.findFirst({
        where: buildWhere(lastRowId),
        orderBy: { id: "asc" },
        select: { id: true }
      });
      hasMore = Boolean(nextRow);
    }

    const reasons = Array.from(reasonCounter.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return NextResponse.json({
      ok: true,
      hasMore,
      nextCursor: hasMore ? lastRowId : null,
      batch: batchStats,
      reasons
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Payload invalido" }, { status: 400 });
    }

    console.error("ml resync photos error", error);
    return NextResponse.json({ error: "No se pudo completar la resincronizacion" }, { status: 500 });
  }
}