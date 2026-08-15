import type { Route } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { PanelRoutePrefetch } from "@/components/panel-route-prefetch";

type Shortcut = {
  href: Route;
  title: string;
  icon: "inventory" | "new" | "loan" | "finance" | "public" | "users";
  roles?: string[];
};

const shortcuts: Shortcut[] = [
  {
    href: "/inventory",
    title: "INVENTARIO",
    icon: "inventory"
  },
  {
    href: "/inventory/manual",
    title: "NUEVO REGISTRO",
    icon: "new"
  },
  {
    href: "/inventory/prestadas",
    title: "PRESTADO",
    icon: "loan"
  },
  {
    href: "/finanzas",
    title: "CONTROL DE GASTOS",
    icon: "finance"
  },
  {
    href: "/public-inventory",
    title: "INVENTARIO PUBLICO",
    icon: "public"
  },
  {
    href: "/panel/users",
    title: "GESTION DE USUARIOS",
    icon: "users",
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
    case "finance":
      return (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M4 19h16" strokeLinecap="round" />
          <path d="M7 15v-4M12 15V8m5 7v-2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M8.5 6.5c.7-.7 1.6-1.1 2.5-1.1 1.7 0 3.1 1.2 3.1 2.6 0 2-2.5 2.4-2.5 3.9" strokeLinecap="round" strokeLinejoin="round" />
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
              className="inline-flex items-center gap-2 rounded-md border border-slate-600 bg-slate-900/70 px-3 py-2 text-sm font-semibold text-slate-100 transition hover:border-slate-400 hover:bg-slate-800/80 active:border-amber-400/70 active:bg-amber-500/15 active:text-amber-100"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path d="M9 5H5v14h4" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M15 8l4 4-4 4M8 12h11" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>Cerrar sesión</span>
            </a>
          </div>

          <div className="mt-6 flex max-w-xl flex-col gap-3">
            {visibleShortcuts.map((shortcut) => (
              <Link
                key={shortcut.href}
                href={shortcut.href}
                className="group flex w-full items-center justify-between rounded-2xl border border-slate-600 bg-slate-900/70 px-4 py-3 transition hover:border-slate-400 hover:bg-slate-900 active:border-amber-400/70 active:bg-amber-500/15"
              >
                <span className="flex items-center gap-3">
                  <span className="rounded-xl border border-slate-700 bg-slate-950/80 p-2 text-slate-200 transition group-hover:text-white group-active:text-amber-100">
                    <ShortcutIcon icon={shortcut.icon} />
                  </span>
                  <span className="text-sm font-semibold tracking-[0.08em] text-slate-100 transition group-hover:text-white group-active:text-amber-100">{shortcut.title}</span>
                </span>
                <span className="text-[11px] uppercase tracking-[0.25em] text-slate-400 transition group-hover:text-slate-200 group-active:text-amber-200">Entrar</span>
              </Link>
            ))}
          </div>
        </section>

        <section className="hidden" aria-hidden="true">
          {visibleShortcuts.map((shortcut) => (
            <Link
              key={shortcut.href}
              href={shortcut.href}
              className="group rounded-2xl border border-slate-700 p-6 transition hover:border-white/40"
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
