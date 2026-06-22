"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";

type UserSummary = {
  id: string;
  name: string;
  email: string;
  role: string;
  createdAt: string;
};

type UserManagementClientProps = {
  initialUsers: UserSummary[];
};

const roles = [
  { value: "admin", label: "Admin" },
  { value: "operator", label: "Operador" },
  { value: "viewer", label: "Solo lectura" },
  { value: "uploader", label: "Capturista (solo altas)" }
];

const formatDateTime = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(parsed);
};

export function UserManagementClient({ initialUsers }: UserManagementClientProps) {
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "operator" });
  const [users, setUsers] = useState<UserSummary[]>(initialUsers);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const usersSorted = useMemo(() => {
    return [...users].sort((a, b) => {
      const aTime = new Date(a.createdAt).getTime();
      const bTime = new Date(b.createdAt).getTime();
      if (!Number.isFinite(aTime) || !Number.isFinite(bTime)) return 0;
      return bTime - aTime;
    });
  }, [users]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((data as { error?: string }).error || "No se pudo registrar");
      }

      const created = (data as { user?: UserSummary }).user;
      if (created) {
        setUsers((current) => {
          const exists = current.some((item) => item.id === created.id || item.email === created.email);
          if (exists) return current;
          return [created, ...current];
        });
      }

      setForm({ name: "", email: "", password: "", role: "operator" });
      setSuccess("Usuario creado correctamente.");
    } catch (submitError: any) {
      setError(submitError?.message || "No se pudo registrar");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="space-y-6 rounded-3xl border border-slate-800 bg-slate-900/60 p-6 shadow-xl">
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-[0.3em] text-violet-300">Gestion de usuarios</p>
        <h1 className="text-2xl font-semibold text-white">Alta de cuentas internas</h1>
        <p className="text-sm text-slate-300">
          Crea nuevos usuarios del sistema. Esta opción ya no está disponible en el login público.
        </p>
      </div>

      <form className="grid grid-cols-1 gap-3 rounded-2xl border border-slate-700 bg-slate-950/50 p-4 md:grid-cols-2" onSubmit={onSubmit}>
        <div className="space-y-2">
          <label className="text-sm text-slate-200">Nombre</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))}
            className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 focus:border-violet-400 focus:outline-none"
            required
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm text-slate-200">Email</label>
          <input
            type="email"
            value={form.email}
            onChange={(e) => setForm((current) => ({ ...current, email: e.target.value }))}
            className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 focus:border-violet-400 focus:outline-none"
            required
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm text-slate-200">Contrasena</label>
          <input
            type="password"
            value={form.password}
            onChange={(e) => setForm((current) => ({ ...current, password: e.target.value }))}
            className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 focus:border-violet-400 focus:outline-none"
            minLength={6}
            required
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm text-slate-200">Rol</label>
          <select
            value={form.role}
            onChange={(e) => setForm((current) => ({ ...current, role: e.target.value }))}
            className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 focus:border-violet-400 focus:outline-none"
          >
            {roles.map((role) => (
              <option key={role.value} value={role.value}>
                {role.label}
              </option>
            ))}
          </select>
        </div>

        <div className="md:col-span-2 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={loading}
            className="rounded-md bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:opacity-60"
          >
            {loading ? "Creando..." : "Crear usuario"}
          </button>
          <Link
            href="/panel"
            className="rounded-md border border-slate-600 px-4 py-2 text-sm text-slate-200 transition hover:border-violet-400"
          >
            Volver al panel
          </Link>
          {error && <p className="text-sm text-amber-400">{error}</p>}
          {success && <p className="text-sm text-emerald-300">{success}</p>}
        </div>
      </form>

      <div className="overflow-hidden rounded-2xl border border-slate-700 bg-slate-950/40">
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-200">Usuarios existentes</h2>
          <span className="text-xs text-slate-400">{usersSorted.length} total</span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-900/70 text-slate-300">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Nombre</th>
                <th className="px-4 py-2 text-left font-medium">Email</th>
                <th className="px-4 py-2 text-left font-medium">Rol</th>
                <th className="px-4 py-2 text-left font-medium">Creado</th>
              </tr>
            </thead>
            <tbody>
              {usersSorted.map((user) => (
                <tr key={user.id} className="border-t border-slate-800 text-slate-200">
                  <td className="px-4 py-2">{user.name || "-"}</td>
                  <td className="px-4 py-2">{user.email}</td>
                  <td className="px-4 py-2 uppercase">{user.role}</td>
                  <td className="px-4 py-2 text-slate-400">{formatDateTime(user.createdAt)}</td>
                </tr>
              ))}
              {usersSorted.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-slate-400">
                    Aun no hay usuarios registrados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
