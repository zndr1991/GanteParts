export const dynamic = "force-dynamic";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { InventoryClient } from "./client";
import type { InventoryClientItem, InventoryInitialPage } from "./client";
import { getInventorySnapshot } from "@/lib/inventory-cache";

const DEFAULT_INITIAL_PAGE_SIZE = 60;
const INVENTORY_FULL_PAGE_SIZE_ENV = Number(
  process.env.INVENTORY_INITIAL_LOAD_LIMIT ??
    process.env.INVENTORY_FULL_LOAD_LIMIT ??
    `${DEFAULT_INITIAL_PAGE_SIZE}`
);
const INVENTORY_FULL_PAGE_SIZE =
  Number.isFinite(INVENTORY_FULL_PAGE_SIZE_ENV) && INVENTORY_FULL_PAGE_SIZE_ENV > 0
    ? INVENTORY_FULL_PAGE_SIZE_ENV
    : DEFAULT_INITIAL_PAGE_SIZE;

export default async function InventoryPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const role = (session.user.role ?? "").toLowerCase();
  const ownerId = role === "viewer" ? session.user.id : null;
  const { items, total } = await getInventorySnapshot(ownerId, INVENTORY_FULL_PAGE_SIZE);
  const plainItems = items as InventoryClientItem[];
  const initialPageSize = plainItems.length || INVENTORY_FULL_PAGE_SIZE;

  const initialPage: InventoryInitialPage = {
    items: plainItems,
    page: 1,
    pageSize: initialPageSize,
    total
  };

  return (
    <InventoryClient
      initialPage={initialPage}
      userRole={session.user.role ?? "operator"}
    />
  );
}
