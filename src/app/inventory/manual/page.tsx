export const dynamic = "force-dynamic";

import { auth } from "@/lib/auth";
import { getManualInventorySnapshot } from "@/lib/inventory-cache";
import { redirect } from "next/navigation";

import { InventoryClient } from "../client";
import type { InventoryClientItem, InventoryInitialPage } from "../client";

const MANUAL_SUGGESTION_LIMIT = 80;

export default async function ManualInventoryPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const role = (session.user.role ?? "operator").toLowerCase();
  const ownerId = role === "viewer" ? session.user.id : null;
  const { items } = await getManualInventorySnapshot(ownerId, MANUAL_SUGGESTION_LIMIT);
  const serialized = items as InventoryClientItem[];

  const initialPage: InventoryInitialPage = {
    items: serialized,
    page: 1,
    pageSize: serialized.length || 1,
    total: serialized.length
  };

  return (
    <InventoryClient
      initialPage={initialPage}
      userRole={session.user.role ?? "operator"}
      mode="manual-only"
    />
  );
}
