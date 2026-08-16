export const dynamic = "force-dynamic";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { InventoryClient } from "./client";
import type { InventoryInitialPage } from "./client";

const EMPTY_INITIAL_PAGE: InventoryInitialPage = {
  items: [],
  page: 1,
  pageSize: 100,
  total: 0,
  statusTotals: {}
};

export default async function InventoryPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  // Shell inmediato: la data completa se carga por API paginada en el cliente.
  // Evita bloquear la entrada 40s+ leyendo base64 de fotos en SSR.
  return (
    <InventoryClient
      initialPage={EMPTY_INITIAL_PAGE}
      userRole={session.user.role ?? "operator"}
      initialDatasetComplete={false}
    />
  );
}
