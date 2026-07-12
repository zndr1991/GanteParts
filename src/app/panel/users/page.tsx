import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

import { UserManagementClient } from "./user-management-client";

const canManageUsers = (role?: string | null) => {
  return (role ?? "").toLowerCase() === "admin";
};

export default async function PanelUsersPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  if (!canManageUsers(session.user.role)) {
    redirect("/panel");
  }

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    take: 150,
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      createdAt: true
    }
  });

  const initialUsers = users.map((user) => ({
    id: user.id,
    name: user.name ?? "",
    email: user.email,
    role: user.role,
    createdAt: user.createdAt.toISOString()
  }));

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-10 text-slate-100">
      <div className="mx-auto max-w-5xl">
        <UserManagementClient initialUsers={initialUsers} currentUserId={session.user.id} />
      </div>
    </main>
  );
}
