export const dynamic = "force-dynamic";

import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

import { FinanceClient } from "./client";

export default async function FinancePage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  return <FinanceClient userRole={session.user.role ?? "operator"} />;
}
