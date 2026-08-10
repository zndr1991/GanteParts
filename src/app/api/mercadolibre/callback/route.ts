export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const TOKEN_URL = "https://api.mercadolibre.com/oauth/token";
const STATE_COOKIE = "ml_oauth_state";

type ParsedOAuthState = {
  state: string;
  targetUserId: string | null;
  nextPath: string;
};

function getEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var ${name}`);
  }
  return value;
}

async function requestAccessToken(code: string) {
  const clientId = getEnv("ML_APP_ID");
  const clientSecret = getEnv("ML_APP_SECRET");
  const redirectUri = getEnv("ML_REDIRECT_URI");

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri
  });

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  const payload = await response.json();
  if (!response.ok) {
    const message = typeof payload?.message === "string" ? payload.message : "Token exchange failed";
    throw new Error(message);
  }

  return payload as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    scope?: string;
    user_id?: string | number;
  };
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

const parseStoredOAuthState = (value: string | undefined): ParsedOAuthState | null => {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as {
      state?: unknown;
      targetUserId?: unknown;
      nextPath?: unknown;
    };

    if (typeof parsed.state !== "string" || !parsed.state.trim().length) {
      return null;
    }

    const targetUserId =
      typeof parsed.targetUserId === "string" && parsed.targetUserId.trim().length
        ? parsed.targetUserId.trim()
        : null;

    return {
      state: parsed.state,
      targetUserId,
      nextPath: normalizeNextPath(typeof parsed.nextPath === "string" ? parsed.nextPath : null)
    };
  } catch {
    const legacyState = value.trim();
    if (!legacyState.length) {
      return null;
    }

    return {
      state: legacyState,
      targetUserId: null,
      nextPath: "/inventory"
    };
  }
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code || !state) {
    return NextResponse.json({ error: "Parametros incompletos" }, { status: 400 });
  }

  const cookieStore = cookies();
  const storedState = parseStoredOAuthState(cookieStore.get(STATE_COOKIE)?.value);
  cookieStore.delete(STATE_COOKIE);

  if (!storedState || storedState.state !== state) {
    return NextResponse.json({ error: "Estado invalido" }, { status: 400 });
  }

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Sesion requerida" }, { status: 401 });
  }

  let targetUserId = session.user.id;
  if (storedState.targetUserId && storedState.targetUserId !== session.user.id) {
    if (!canManageUsers(session.user.role)) {
      return NextResponse.json({ error: "Sin permisos para vincular otra cuenta" }, { status: 403 });
    }

    const targetUser = await prisma.user.findUnique({
      where: { id: storedState.targetUserId },
      select: { id: true }
    });

    if (!targetUser) {
      return NextResponse.json({ error: "Usuario objetivo no encontrado" }, { status: 404 });
    }

    targetUserId = targetUser.id;
  }

  try {
    const tokenPayload = await requestAccessToken(code);
    const expiresBuffer = Math.max(tokenPayload.expires_in - 60, 60);
    const expiresAt = new Date(Date.now() + expiresBuffer * 1000);
    const mlUserId = String(tokenPayload.user_id ?? targetUserId);

    await prisma.mercadoLibreAccount.upsert({
      where: {
        userId_mlUserId: {
          userId: targetUserId,
          mlUserId
        }
      },
      update: {
        accessToken: tokenPayload.access_token,
        refreshToken: tokenPayload.refresh_token,
        scope: tokenPayload.scope ?? null,
        expiresAt
      },
      create: {
        userId: targetUserId,
        mlUserId,
        accessToken: tokenPayload.access_token,
        refreshToken: tokenPayload.refresh_token,
        scope: tokenPayload.scope ?? null,
        expiresAt
      }
    });

    const redirect = new URL(storedState.nextPath, url.origin);
    redirect.searchParams.set("mlLinked", "1");
    if (targetUserId !== session.user.id) {
      redirect.searchParams.set("mlLinkedUserId", targetUserId);
    }
    return NextResponse.redirect(redirect);
  } catch (error) {
    console.error("MercadoLibre OAuth error", error);
    return NextResponse.json({ error: "No se pudo vincular la cuenta" }, { status: 500 });
  }
}
