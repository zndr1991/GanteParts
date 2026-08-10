export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import crypto from "crypto";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const AUTH_URL = process.env.ML_AUTH_URL || "https://auth.mercadolibre.com.mx/authorization";
const STATE_COOKIE = "ml_oauth_state";
const STATE_TTL_SECONDS = 10 * 60;

type StoredOAuthState = {
  state: string;
  targetUserId: string;
  nextPath: string;
};

function getEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var ${name}`);
  }
  return value;
}

const canManageUsers = (role?: string | null) => (role ?? "").toLowerCase() === "admin";

const normalizeNextPath = (value: string | null) => {
  if (!value) return "/inventory";
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return "/inventory";
  }
  return trimmed;
};

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const requestUrl = new URL(request.url);
  const requestedTargetUserId = (requestUrl.searchParams.get("targetUserId") ?? "").trim();
  const nextPath = normalizeNextPath(requestUrl.searchParams.get("next"));
  let targetUserId = session.user.id;

  if (requestedTargetUserId.length && requestedTargetUserId !== session.user.id) {
    if (!canManageUsers(session.user.role)) {
      return NextResponse.json({ error: "Sin permisos para vincular otra cuenta" }, { status: 403 });
    }

    const targetUser = await prisma.user.findUnique({
      where: { id: requestedTargetUserId },
      select: { id: true }
    });

    if (!targetUser) {
      return NextResponse.json({ error: "Usuario objetivo no encontrado" }, { status: 404 });
    }

    targetUserId = targetUser.id;
  }

  const clientId = getEnv("ML_APP_ID");
  const redirectUri = getEnv("ML_REDIRECT_URI");
  const scopes = ["read", "write", "offline_access"].join(" ");

  const state = crypto.randomBytes(24).toString("hex");
  const statePayload: StoredOAuthState = {
    state,
    targetUserId,
    nextPath
  };

  const cookieStore = cookies();
  cookieStore.set(STATE_COOKIE, JSON.stringify(statePayload), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: STATE_TTL_SECONDS,
    path: "/"
  });

  const url = new URL(AUTH_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", scopes);
  url.searchParams.set("state", state);

  return NextResponse.redirect(url);
}
