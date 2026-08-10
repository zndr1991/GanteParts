import type { Route } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { PanelRoutePrefetch } from "@/components/panel-route-prefetch";

type Shortcut = {
  href: Route;
  title: string;
  border: string;
  icon: "inventory" | "new" | "loan" | "public" | "users";
  textColor: string;
  roles?: string[];
};

const shortcuts: Shortcut[] = [
  {
    href: "/inventory",
    title: "INVENTARIO",
    border: "border-emerald-400/40",
    icon: "inventory",
    textColor: "text-emerald-100"
  },
  {
    href: "/inventory/manual",
    title: "NUEVO REGISTRO",
    border: "border-amber-400/40",
    icon: "new",
    textColor: "text-amber-100"
  },
  {
    href: "/inventory/prestadas",
    title: "PRESTADO",
    border: "border-sky-400/40",
    icon: "loan",
    textColor: "text-sky-100"
  },
  {
    href: "/public-inventory",
    title: "INVENTARIO PUBLICO",
    border: "border-cyan-400/40",
    icon: "public",
    textColor: "text-cyan-100"
  },
  {
    href: "/panel/users",
    title: "GESTION DE USUARIOS",
    border: "border-violet-400/40",
    icon: "users",
    textColor: "text-violet-100",
    roles: ["admin"]
  }
];

function ShortcutIcon({ icon }: { icon: Shortcut["icon"] }) {
  switch (icon) {
    case "inventory":
      return (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M4 7h16M4 12h16M4 17h10" strokeLinecap="round" />
        </svg>
      );
    case "new":
      return (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M12 5v14M5 12h14" strokeLinecap="round" />
          <rect x="4" y="4" width="16" height="16" rx="3" />
        </svg>
      );
    case "loan":
      return (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M4 12h8m0 0-3-3m3 3-3 3" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M14 7h6v10h-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "public":
      return (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <circle cx="12" cy="12" r="8" />
          <path d="M4 12h16M12 4a14 14 0 0 1 0 16M12 4a14 14 0 0 0 0 16" strokeLinecap="round" />
        </svg>
      );
    case "users":
      return (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <circle cx="9" cy="8" r="3" />
          <path d="M3 19c0-3 2.5-5 6-5s6 2 6 5" strokeLinecap="round" />
          <path d="M17 8h4M19 6v4" strokeLinecap="round" />
        </svg>
      );
    default:
      return null;
  }
}

export default async function PanelPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const displayName = session.user.name || session.user.email || "Operador";
  const normalizedRole = (session.user.role ?? "operator").toString().toLowerCase();
  const roleLabel = (session.user.role ?? "operator").toString().toUpperCase();
  const visibleShortcuts = shortcuts.filter((shortcut) => {
    if (!shortcut.roles?.length) return true;
    return shortcut.roles.includes(normalizedRole);
  });

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-10 text-slate-100">
      <PanelRoutePrefetch routes={visibleShortcuts.map((shortcut) => shortcut.href)} />
      <div className="mx-auto flex max-w-4xl flex-col gap-8">
        <section className="rounded-3xl border border-slate-800 bg-gradient-to-br from-slate-900/80 to-slate-900/30 p-8 shadow-xl">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.4em] text-amber-400">Panel principal</p>
              <h1 className="mt-3 text-3xl font-semibold text-white">Hola, {displayName}</h1>
              <p className="text-sm uppercase tracking-[0.3em] text-slate-400">Rol · {roleLabel}</p>
            </div>
            <a
              href="/api/auth/signout"
              className="text-sm font-medium text-slate-300 underline decoration-slate-600 underline-offset-4 hover:text-rose-300 hover:decoration-rose-400"
            >
              Cerrar sesión
            </a>
          </div>

          <div className="mt-6 flex max-w-xl flex-col gap-3">
            {visibleShortcuts.map((shortcut) => (
              <Link
                key={shortcut.href}
                href={shortcut.href}
                className={`group flex w-full items-center justify-between rounded-2xl border ${shortcut.border} bg-slate-900/70 px-4 py-3 transition hover:bg-slate-900`}
              >
                <span className="flex items-center gap-3">
                  <span className={`rounded-xl border border-white/10 bg-slate-950/80 p-2 ${shortcut.textColor}`}>
                    <ShortcutIcon icon={shortcut.icon} />
                  </span>
                  <span className={`text-sm font-semibold tracking-[0.08em] ${shortcut.textColor}`}>{shortcut.title}</span>
                </span>
                <span className="text-[11px] uppercase tracking-[0.25em] text-slate-400 group-hover:text-slate-200">Entrar</span>
              </Link>
            ))}
          </div>
        </section>

        <section className="hidden" aria-hidden="true">
          {visibleShortcuts.map((shortcut) => (
            <Link
              key={shortcut.href}
              href={shortcut.href}
              className={`group rounded-2xl border ${shortcut.border} p-6 transition hover:border-white/40`}
            >
              <div className="flex flex-col gap-3">
                <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Acceso rápido</p>
                <div>
                  <h2 className="text-xl font-semibold text-white">{shortcut.title}</h2>
                </div>
                <span className="text-sm font-semibold text-emerald-200 group-hover:text-white">Entrar →</span>
              </div>
            </Link>
          ))}
        </section>
      </div>
    </main>
  );
}
