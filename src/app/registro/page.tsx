import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";

const canManageUsers = (role?: string | null) => {
  return (role ?? "").toLowerCase() === "admin";
};

export default async function RegistroPage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  if (!canManageUsers(session.user.role)) {
    redirect("/panel");
  }

  redirect("/panel/users");
}
