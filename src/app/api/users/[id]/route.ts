export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { Prisma } from "@prisma/client";
import { hash } from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const allowedRoles = ["admin", "operator", "viewer", "uploader"] as const;

const updatePayloadSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    email: z.string().trim().email().optional(),
    role: z.enum(allowedRoles).optional(),
    password: z.string().min(6).max(120).optional()
  })
  .refine((payload) => Object.keys(payload).length > 0, {
    message: "No hay cambios para actualizar"
  });

const canManageUsers = (role?: string | null) => {
  return (role ?? "").toLowerCase() === "admin";
};

const serializeUser = (user: {
  id: string;
  name: string | null;
  email: string;
  role: string;
  createdAt: Date;
}) => ({
  id: user.id,
  name: user.name ?? "",
  email: user.email,
  role: user.role,
  createdAt: user.createdAt.toISOString()
});

async function ensureAdminSession() {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: "No autenticado" }, { status: 401 }) };
  }

  if (!canManageUsers(session.user.role)) {
    return { error: NextResponse.json({ error: "Sin permisos para gestionar usuarios" }, { status: 403 }) };
  }

  return { session };
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const authResult = await ensureAdminSession();
    if (authResult.error) {
      return authResult.error;
    }

    const session = authResult.session;
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const parsed = updatePayloadSchema.parse(await req.json());

    const target = await prisma.user.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        email: true,
        role: true
      }
    });

    if (!target) {
      return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
    }

    if (params.id === session.user.id && parsed.role && parsed.role !== "admin") {
      return NextResponse.json({ error: "No puedes quitarte el rol admin a ti mismo" }, { status: 400 });
    }

    if (target.role.toLowerCase() === "admin" && parsed.role && parsed.role !== "admin") {
      const adminCount = await prisma.user.count({ where: { role: "admin" } });
      if (adminCount <= 1) {
        return NextResponse.json({ error: "Debe existir al menos un admin" }, { status: 400 });
      }
    }

    if (parsed.email && parsed.email.toLowerCase() !== target.email.toLowerCase()) {
      const existingEmail = await prisma.user.findUnique({ where: { email: parsed.email } });
      if (existingEmail) {
        return NextResponse.json({ error: "El email ya existe" }, { status: 400 });
      }
    }

    const data: Prisma.UserUpdateInput = {};

    if (parsed.name !== undefined) {
      data.name = parsed.name;
    }
    if (parsed.email !== undefined) {
      data.email = parsed.email.toLowerCase();
    }
    if (parsed.role !== undefined) {
      data.role = parsed.role;
    }
    if (parsed.password !== undefined) {
      data.passwordHash = await hash(parsed.password, 10);
    }

    const updated = await prisma.user.update({
      where: { id: params.id },
      data,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true
      }
    });

    return NextResponse.json({ ok: true, user: serializeUser(updated) });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Datos invalidos para actualizar" }, { status: 400 });
    }

    console.error("user patch error", error);
    return NextResponse.json({ error: "No se pudo actualizar el usuario" }, { status: 500 });
  }
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  try {
    const authResult = await ensureAdminSession();
    if (authResult.error) {
      return authResult.error;
    }

    const session = authResult.session;
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    if (params.id === session.user.id) {
      return NextResponse.json({ error: "No puedes eliminar tu propia cuenta" }, { status: 400 });
    }

    const target = await prisma.user.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        role: true
      }
    });

    if (!target) {
      return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
    }

    if (target.role.toLowerCase() === "admin") {
      const adminCount = await prisma.user.count({ where: { role: "admin" } });
      if (adminCount <= 1) {
        return NextResponse.json({ error: "No puedes eliminar el ultimo admin" }, { status: 400 });
      }
    }

    await prisma.user.delete({ where: { id: params.id } });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("user delete error", error);
    return NextResponse.json({ error: "No se pudo eliminar el usuario" }, { status: 500 });
  }
}
