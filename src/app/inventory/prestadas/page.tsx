export const dynamic = "force-dynamic";

import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

import { InventoryClient } from "../client";
import type { InventoryClientItem, InventoryInitialPage } from "../client";
import { getInventorySnapshot } from "@/lib/inventory-cache";

export default async function PrestadasInventoryPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const role = (session.user.role ?? "").toLowerCase();
  const ownerId = role === "viewer" ? session.user.id : null;
  const { items, total, statusTotals, complete } = await getInventorySnapshot(ownerId);
  const plainItems = items as InventoryClientItem[];
  const initialPageSize = plainItems.length || 1;

  const initialPage: InventoryInitialPage = {
    items: plainItems,
    page: 1,
    pageSize: initialPageSize,
    total,
    statusTotals
  };

  return (
    <InventoryClient
      initialPage={initialPage}
      userRole={session.user.role ?? "operator"}
      initialStatusFilter="PRESTADO"
      initialDatasetComplete={complete}
    />
  );
}
