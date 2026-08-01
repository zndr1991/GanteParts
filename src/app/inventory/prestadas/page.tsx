export const dynamic = "force-dynamic";

import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

import { InventoryClient } from "../client";
import type { InventoryClientItem, InventoryInitialPage } from "../client";
import { getInventorySnapshot } from "@/lib/inventory-cache";

const DEFAULT_INITIAL_PAGE_SIZE = 120;
const MAX_INITIAL_PAGE_SIZE = 5000;
const INVENTORY_FULL_PAGE_SIZE_ENV = Number(
  process.env.INVENTORY_INITIAL_LOAD_LIMIT ??
    process.env.INVENTORY_FULL_LOAD_LIMIT ??
    `${DEFAULT_INITIAL_PAGE_SIZE}`
);
const INVENTORY_FULL_PAGE_SIZE =
  Number.isFinite(INVENTORY_FULL_PAGE_SIZE_ENV) && INVENTORY_FULL_PAGE_SIZE_ENV > 0
    ? Math.min(Math.floor(INVENTORY_FULL_PAGE_SIZE_ENV), MAX_INITIAL_PAGE_SIZE)
    : DEFAULT_INITIAL_PAGE_SIZE;

const hasPrestadoStatus = (item: InventoryClientItem) => {
  const status = (item.extraData?.estatus_interno ?? "").toString().trim().toUpperCase();
  return status === "PRESTADO";
};

export default async function PrestadasInventoryPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const role = (session.user.role ?? "").toLowerCase();
  const ownerId = role === "viewer" ? session.user.id : null;
  const { items, statusTotals } = await getInventorySnapshot(ownerId, INVENTORY_FULL_PAGE_SIZE);
  const plainItems = items as InventoryClientItem[];
  const prestadasItems = plainItems.filter(hasPrestadoStatus);
  const totalPrestadas = typeof statusTotals?.PRESTADO === "number" ? statusTotals.PRESTADO : prestadasItems.length;
  const initialPageSize = prestadasItems.length || INVENTORY_FULL_PAGE_SIZE;

  const initialPage: InventoryInitialPage = {
    items: prestadasItems,
    page: 1,
    pageSize: initialPageSize,
    total: totalPrestadas,
    statusTotals
  };

  return (
    <InventoryClient
      initialPage={initialPage}
      userRole={session.user.role ?? "operator"}
      initialStatusFilter="PRESTADO"
    />
  );
}
