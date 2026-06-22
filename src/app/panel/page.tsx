import type { Route } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { PanelRoutePrefetch } from "@/components/panel-route-prefetch";

type Shortcut = {
  href: Route;
  title: string;
  description: string;
  accent: string;
  border: string;
  roles?: string[];
};

const shortcuts: Shortcut[] = [
  {
    href: "/inventory",
    title: "Inventario completo",
    description: "Revisa existencias, sincroniza con Mercado Libre y administra fotos.",
    accent: "from-emerald-500/20 to-emerald-500/5",
    border: "border-emerald-400/40"
  },
  {
    href: "/inventory/manual",
    title: "Captura manual",
    description: "Dar de alta piezas al instante sin cargar toda la tabla.",
    accent: "from-amber-500/20 to-amber-500/5",
    border: "border-amber-400/40"
  },
  {
    href: "/public-inventory",
    title: "Inventario público",
    description: "Comparte tu catálogo externo sin exponer datos internos.",
    accent: "from-cyan-500/15 to-cyan-500/5",
    border: "border-cyan-400/40"
  },
  {
    href: "/finanzas",
    title: "Control de gastos",
    description: "Registra ingresos, egresos semanales y administra deudas con abonos.",
    accent: "from-amber-500/20 to-amber-500/5",
    border: "border-amber-400/40"
  },
  {
    href: "/panel/users",
    title: "Gestion de usuarios",
    description: "Crea cuentas internas y define roles de acceso para el equipo.",
    accent: "from-violet-500/15 to-violet-500/5",
    border: "border-violet-400/40",
    roles: ["admin"]
  }
];

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
          <p className="text-xs uppercase tracking-[0.4em] text-amber-400">Panel principal</p>
          <h1 className="mt-3 text-3xl font-semibold text-white">Hola, {displayName}</h1>
          <p className="text-sm uppercase tracking-[0.3em] text-slate-400">Rol · {roleLabel}</p>
          <p className="mt-4 max-w-2xl text-slate-300">
            Elige qué quieres hacer hoy. Puedes abrir la captura manual en una pestaña ligera o entrar al inventario completo
            cuando necesites ver todo el catálogo.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/inventory"
              className="rounded-full border border-emerald-400/50 px-4 py-2 text-sm font-semibold text-emerald-200 hover:bg-emerald-500/10"
            >
              Ir al inventario
            </Link>
            <Link
              href="/inventory/manual"
              className="rounded-full border border-amber-400/50 px-4 py-2 text-sm font-semibold text-amber-200 hover:bg-amber-500/10"
            >
              Abrir captura manual
            </Link>
            <Link
              href="/public-inventory"
              className="rounded-full border border-cyan-400/50 px-4 py-2 text-sm font-semibold text-cyan-200 hover:bg-cyan-500/10"
            >
              Ver inventario público
            </Link>
            <Link
              href="/finanzas"
              className="rounded-full border border-amber-400/50 px-4 py-2 text-sm font-semibold text-amber-200 hover:bg-amber-500/10"
            >
              Abrir finanzas
            </Link>
            {normalizedRole === "admin" && (
              <Link
                href="/panel/users"
                className="rounded-full border border-violet-400/50 px-4 py-2 text-sm font-semibold text-violet-200 hover:bg-violet-500/10"
              >
                Gestion de usuarios
              </Link>
            )}
            <a
              href="/api/auth/signout"
              className="rounded-full border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-rose-400"
            >
              Cerrar sesión
            </a>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2">
          {visibleShortcuts.map((shortcut) => (
            <Link
              key={shortcut.href}
              href={shortcut.href}
              className={`group rounded-2xl border ${shortcut.border} bg-gradient-to-br ${shortcut.accent} p-6 transition hover:border-white/40`}
            >
              <div className="flex flex-col gap-3">
                <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Acceso rápido</p>
                <div>
                  <h2 className="text-xl font-semibold text-white">{shortcut.title}</h2>
                  <p className="text-sm text-slate-300">{shortcut.description}</p>
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
