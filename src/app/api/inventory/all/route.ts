export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getInventoryFullSnapshot } from "@/lib/inventory-full-snapshot";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const role = (session.user.role ?? "").toLowerCase();
  const ownerId = role === "viewer" ? session.user.id : null;
  const snapshot = await getInventoryFullSnapshot(ownerId);

  return NextResponse.json({
    total: snapshot.total,
    statusTotals: snapshot.statusTotals,
    items: snapshot.items,
    skippedCount: snapshot.skippedCount,
    truncated: snapshot.truncated,
    complete: snapshot.complete
  });
}
