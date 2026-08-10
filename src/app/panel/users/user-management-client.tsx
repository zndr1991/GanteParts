"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type UserSummary = {
  id: string;
  name: string;
  email: string;
  role: string;
  createdAt: string;
  hasMercadoLibreLinked: boolean;
};

type UserManagementClientProps = {
  initialUsers: UserSummary[];
  currentUserId: string;
};

type RegisterResponse = {
  error?: string;
  user?: UserSummary;
};

type UpdateResponse = {
  error?: string;
  user?: UserSummary;
};

type ResyncBatchStats = {
  processed: number;
  syncedOk: number;
  warnings: number;
  errors: number;
  skippedNoMlItemId: number;
  skippedNoPhotos: number;
  skippedMissingAccount: number;
  retriedItems: number;
  retryAttemptsUsed: number;
};

type ResyncSummary = ResyncBatchStats & {
  batches: number;
  topReasons: Array<{ reason: string; count: number }>;
};

type ResyncBatchResponse = {
  ok?: boolean;
  error?: string;
  hasMore?: boolean;
  nextCursor?: string | null;
  batch?: ResyncBatchStats;
  reasons?: Array<{ reason: string; count: number }>;
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

const createEmptyResyncStats = (): ResyncBatchStats => ({
  processed: 0,
  syncedOk: 0,
  warnings: 0,
  errors: 0,
  skippedNoMlItemId: 0,
  skippedNoPhotos: 0,
  skippedMissingAccount: 0,
  retriedItems: 0,
  retryAttemptsUsed: 0
});

const accumulateResyncStats = (target: ResyncBatchStats, batch: ResyncBatchStats) => {
  target.processed += batch.processed;
  target.syncedOk += batch.syncedOk;
  target.warnings += batch.warnings;
  target.errors += batch.errors;
  target.skippedNoMlItemId += batch.skippedNoMlItemId;
  target.skippedNoPhotos += batch.skippedNoPhotos;
  target.skippedMissingAccount += batch.skippedMissingAccount;
  target.retriedItems += batch.retriedItems;
  target.retryAttemptsUsed += batch.retryAttemptsUsed;
};

const buildMlAuthLink = (userId: string) =>
  `/api/mercadolibre/auth?targetUserId=${encodeURIComponent(userId)}&next=${encodeURIComponent("/panel/users")}`;

export function UserManagementClient({ initialUsers, currentUserId }: UserManagementClientProps) {
  const searchParams = useSearchParams();
  const oauthHandledRef = useRef(false);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "operator" });
  const [users, setUsers] = useState<UserSummary[]>(initialUsers);
  const [editUserId, setEditUserId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: "", email: "", password: "", role: "operator" });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [resyncing, setResyncing] = useState(false);
  const [resyncProgress, setResyncProgress] = useState<string | null>(null);
  const [resyncSummary, setResyncSummary] = useState<ResyncSummary | null>(null);

  useEffect(() => {
    if (oauthHandledRef.current) return;
    if (searchParams.get("mlLinked") !== "1") return;

    oauthHandledRef.current = true;
    const linkedUserId = searchParams.get("mlLinkedUserId");

    if (linkedUserId) {
      setUsers((current) =>
        current.map((user) =>
          user.id === linkedUserId
            ? {
                ...user,
                hasMercadoLibreLinked: true
              }
            : user
        )
      );
      const linkedUser = users.find((entry) => entry.id === linkedUserId);
      setSuccess(
        linkedUser
          ? `Mercado Libre vinculado para ${linkedUser.email}.`
          : "Mercado Libre vinculado para el usuario seleccionado."
      );
    } else {
      setUsers((current) =>
        current.map((user) =>
          user.id === currentUserId
            ? {
                ...user,
                hasMercadoLibreLinked: true
              }
            : user
        )
      );
      setSuccess("Cuenta de Mercado Libre vinculada correctamente.");
    }

    setError(null);
    if (typeof window !== "undefined") {
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.delete("mlLinked");
      nextUrl.searchParams.delete("mlLinkedUserId");
      window.history.replaceState({}, "", `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
    }
  }, [currentUserId, searchParams, users]);

  const usersSorted = useMemo(() => {
    return [...users].sort((a, b) => {
      const aTime = new Date(a.createdAt).getTime();
      const bTime = new Date(b.createdAt).getTime();
      if (!Number.isFinite(aTime) || !Number.isFinite(bTime)) return 0;
      return bTime - aTime;
    });
  }, [users]);

  const editingUser = useMemo(() => {
    if (!editUserId) return null;
    return users.find((user) => user.id === editUserId) ?? null;
  }, [users, editUserId]);

  const linkedUsersCount = useMemo(
    () => users.reduce((total, user) => total + (user.hasMercadoLibreLinked ? 1 : 0), 0),
    [users]
  );

  const pendingLinkedUsersCount = Math.max(0, users.length - linkedUsersCount);

  const clearFeedback = () => {
    setError(null);
    setSuccess(null);
  };

  const beginEdit = (user: UserSummary) => {
    clearFeedback();
    setEditUserId(user.id);
    setEditForm({
      name: user.name ?? "",
      email: user.email,
      role: user.role,
      password: ""
    });
  };

  const cancelEdit = () => {
    setEditUserId(null);
    setEditForm({ name: "", email: "", password: "", role: "operator" });
  };

  const updateLocalUser = (updated: UserSummary) => {
    setUsers((current) => current.map((user) => (user.id === updated.id ? updated : user)));
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    clearFeedback();

    try {
      const response = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });

      const data = (await response.json().catch(() => ({}))) as RegisterResponse;
      if (!response.ok) {
        throw new Error(data.error || "No se pudo registrar");
      }

      const created = data.user;
      if (created) {
        setUsers((current) => {
          const exists = current.some((item) => item.id === created.id || item.email === created.email);
          if (exists) return current;
          return [created, ...current];
        });
      }

      setForm({ name: "", email: "", password: "", role: "operator" });
      setSuccess("Usuario creado correctamente.");
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "No se pudo registrar";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const onSubmitEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!editingUser) {
      return;
    }

    setEditing(true);
    clearFeedback();

    try {
      const payload: { name: string; email: string; role: string; password?: string } = {
        name: editForm.name.trim(),
        email: editForm.email.trim(),
        role: editForm.role
      };

      const trimmedPassword = editForm.password.trim();
      if (trimmedPassword.length > 0) {
        payload.password = trimmedPassword;
      }

      const response = await fetch(`/api/users/${editingUser.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = (await response.json().catch(() => ({}))) as UpdateResponse;
      if (!response.ok) {
        throw new Error(data.error || "No se pudo actualizar");
      }

      if (data.user) {
        updateLocalUser(data.user);
      }

      cancelEdit();
      setSuccess("Usuario actualizado correctamente.");
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "No se pudo actualizar";
      setError(message);
    } finally {
      setEditing(false);
    }
  };

  const onDeleteUser = async (user: UserSummary) => {
    if (user.id === currentUserId) {
      setError("No puedes eliminar tu propia cuenta.");
      return;
    }

    const confirmed = window.confirm(`Eliminar al usuario ${user.email}? Esta accion no se puede deshacer.`);
    if (!confirmed) {
      return;
    }

    setDeletingUserId(user.id);
    clearFeedback();

    try {
      const response = await fetch(`/api/users/${user.id}`, {
        method: "DELETE"
      });

      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error || "No se pudo eliminar");
      }

      setUsers((current) => current.filter((item) => item.id !== user.id));
      if (editUserId === user.id) {
        cancelEdit();
      }
      setSuccess("Usuario eliminado correctamente.");
    } catch (deleteError) {
      const message = deleteError instanceof Error ? deleteError.message : "No se pudo eliminar";
      setError(message);
    } finally {
      setDeletingUserId(null);
    }
  };

  const onRunMassivePhotoResync = async () => {
    const confirmed = window.confirm(
      "Se ejecutara una resincronizacion masiva de fotos hacia Mercado Libre. Continuar?"
    );
    if (!confirmed) {
      return;
    }

    clearFeedback();
    setResyncing(true);
    setResyncProgress("Iniciando resincronizacion...");
    setResyncSummary(null);

    const totals = createEmptyResyncStats();
    const reasonMap = new Map<string, number>();
    let cursor: string | null = null;
    let batches = 0;

    try {
      while (true) {
        const response = await fetch("/api/mercadolibre/resync/photos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cursor: cursor ?? undefined,
            batchSize: 15,
            retryCount: 2
          })
        });

        const data = (await response.json().catch(() => ({}))) as ResyncBatchResponse;
        if (!response.ok) {
          throw new Error(data.error || "No se pudo ejecutar la resincronizacion");
        }

        const batch = data.batch ?? createEmptyResyncStats();
        accumulateResyncStats(totals, batch);
        batches += 1;

        (data.reasons ?? []).forEach((entry) => {
          if (!entry.reason.trim()) return;
          reasonMap.set(entry.reason, (reasonMap.get(entry.reason) ?? 0) + entry.count);
        });

        setResyncProgress(
          `Lote ${batches}: ${totals.processed} procesados | OK ${totals.syncedOk} | Avisos ${totals.warnings} | Errores ${totals.errors}`
        );

        cursor = data.nextCursor ?? null;
        if (!data.hasMore || !cursor) {
          break;
        }
      }

      const topReasons = Array.from(reasonMap.entries())
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      setResyncSummary({
        ...totals,
        batches,
        topReasons
      });

      setSuccess(
        `Resincronizacion finalizada. Procesados: ${totals.processed} | OK: ${totals.syncedOk} | Avisos: ${totals.warnings} | Errores: ${totals.errors}`
      );
    } catch (resyncError) {
      const message = resyncError instanceof Error ? resyncError.message : "No se pudo ejecutar la resincronizacion";
      setError(message);
    } finally {
      setResyncing(false);
      setResyncProgress(null);
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

      <div className="space-y-3 rounded-2xl border border-slate-700 bg-slate-950/50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-slate-300">Vinculacion Mercado Libre</p>
            <p className="text-xs text-slate-400">
              Los usuarios sin vinculacion veran errores de sincronizacion al ejecutar acciones ML.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
            <span className="rounded-full border border-emerald-400/50 bg-emerald-500/15 px-3 py-1 text-emerald-200">
              Vinculados: {linkedUsersCount}
            </span>
            <span className="rounded-full border border-amber-400/50 bg-amber-500/15 px-3 py-1 text-amber-200">
              Sin vincular: {pendingLinkedUsersCount}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onRunMassivePhotoResync}
            disabled={resyncing}
            className="rounded-md border border-cyan-400/60 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-500/20 disabled:opacity-60"
          >
            {resyncing ? "Resincronizando..." : "Resincronizar fotos ML (masivo)"}
          </button>
          {resyncProgress && <span className="text-xs text-slate-300">{resyncProgress}</span>}
        </div>

        {resyncSummary && (
          <div className="grid grid-cols-1 gap-2 text-xs text-slate-200 md:grid-cols-4">
            <div className="rounded-lg border border-slate-700 bg-slate-900/70 px-3 py-2">
              <p className="text-slate-400">Procesados</p>
              <p className="font-semibold text-white">{resyncSummary.processed}</p>
            </div>
            <div className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-2">
              <p className="text-emerald-200">OK</p>
              <p className="font-semibold text-emerald-100">{resyncSummary.syncedOk}</p>
            </div>
            <div className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2">
              <p className="text-amber-200">Avisos</p>
              <p className="font-semibold text-amber-100">{resyncSummary.warnings}</p>
            </div>
            <div className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2">
              <p className="text-rose-200">Errores</p>
              <p className="font-semibold text-rose-100">{resyncSummary.errors}</p>
            </div>
            <div className="md:col-span-4 rounded-lg border border-slate-700 bg-slate-900/70 px-3 py-2 text-slate-300">
              Lotes: {resyncSummary.batches} | Sin cuenta vinculada: {resyncSummary.skippedMissingAccount} | Sin fotos: {resyncSummary.skippedNoPhotos}
              {resyncSummary.topReasons.length > 0 && (
                <span>
                  {" "}
                  | Top motivos: {resyncSummary.topReasons.map((entry) => `${entry.reason} (${entry.count})`).join(" | ")}
                </span>
              )}
            </div>
          </div>
        )}
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
            className="inline-flex items-center gap-2 rounded-md border border-slate-600 bg-slate-900/70 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:border-slate-400 hover:bg-slate-800/80 active:border-amber-400/70 active:bg-amber-500/15 active:text-amber-100"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="M4 4h7v7H4zM13 4h7v5h-7zM13 11h7v9h-7zM4 13h7v7H4z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>Volver al panel</span>
          </Link>
          {error && <p className="text-sm text-amber-400">{error}</p>}
          {success && <p className="text-sm text-emerald-300">{success}</p>}
        </div>
      </form>

      {editingUser && (
        <form
          className="grid grid-cols-1 gap-3 rounded-2xl border border-violet-500/40 bg-slate-950/50 p-4 md:grid-cols-2"
          onSubmit={onSubmitEdit}
        >
          <div className="md:col-span-2 space-y-1">
            <p className="text-xs uppercase tracking-[0.25em] text-violet-300">Editar usuario</p>
            <h2 className="text-lg font-semibold text-white">{editingUser.email}</h2>
            <p className="text-sm text-slate-300">
              Desde aquí puedes editar nombre, email, rol y cambiar la contrasena del usuario.
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm text-slate-200">Nombre</label>
            <input
              type="text"
              value={editForm.name}
              onChange={(e) => setEditForm((current) => ({ ...current, name: e.target.value }))}
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 focus:border-violet-400 focus:outline-none"
              required
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm text-slate-200">Email</label>
            <input
              type="email"
              value={editForm.email}
              onChange={(e) => setEditForm((current) => ({ ...current, email: e.target.value }))}
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 focus:border-violet-400 focus:outline-none"
              required
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm text-slate-200">Rol</label>
            <select
              value={editForm.role}
              onChange={(e) => setEditForm((current) => ({ ...current, role: e.target.value }))}
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 focus:border-violet-400 focus:outline-none"
            >
              {roles.map((role) => (
                <option key={role.value} value={role.value}>
                  {role.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm text-slate-200">Nueva contrasena</label>
            <input
              type="password"
              value={editForm.password}
              onChange={(e) => setEditForm((current) => ({ ...current, password: e.target.value }))}
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 focus:border-violet-400 focus:outline-none"
              minLength={6}
              placeholder="Opcional (dejar vacio para no cambiar)"
            />
          </div>

          <div className="md:col-span-2 flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={editing}
              className="rounded-md bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:opacity-60"
            >
              {editing ? "Guardando..." : "Guardar cambios"}
            </button>
            <button
              type="button"
              onClick={cancelEdit}
              className="rounded-md border border-slate-600 px-4 py-2 text-sm text-slate-200 transition hover:border-violet-400"
            >
              Cancelar edicion
            </button>
          </div>
        </form>
      )}

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
                <th className="px-4 py-2 text-left font-medium">Mercado Libre</th>
                <th className="px-4 py-2 text-left font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {usersSorted.map((user) => (
                <tr key={user.id} className="border-t border-slate-800 text-slate-200">
                  <td className="px-4 py-2">{user.name || "-"}</td>
                  <td className="px-4 py-2">{user.email}</td>
                  <td className="px-4 py-2 uppercase">{user.role}</td>
                  <td className="px-4 py-2 text-slate-400">{formatDateTime(user.createdAt)}</td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {user.hasMercadoLibreLinked ? (
                        <span className="rounded-full border border-emerald-400/50 bg-emerald-500/15 px-2 py-1 text-[11px] font-semibold text-emerald-100">
                          Vinculado
                        </span>
                      ) : (
                        <span className="rounded-full border border-amber-400/50 bg-amber-500/15 px-2 py-1 text-[11px] font-semibold text-amber-100">
                          Sin vincular
                        </span>
                      )}
                      <a
                        href={buildMlAuthLink(user.id)}
                        className="rounded-md border border-sky-400/60 px-2 py-1 text-[11px] font-semibold text-sky-200 transition hover:bg-sky-500/10"
                      >
                        {user.hasMercadoLibreLinked ? "Re-vincular" : "Vincular"}
                      </a>
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => beginEdit(user)}
                        disabled={editing || deletingUserId === user.id}
                        className="rounded-md border border-violet-400/60 px-2 py-1 text-xs font-semibold text-violet-200 transition hover:bg-violet-500/10 disabled:opacity-60"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteUser(user)}
                        disabled={user.id === currentUserId || editing || deletingUserId === user.id}
                        className="rounded-md border border-rose-400/60 px-2 py-1 text-xs font-semibold text-rose-200 transition hover:bg-rose-500/10 disabled:opacity-50"
                      >
                        {deletingUserId === user.id ? "Eliminando..." : "Eliminar"}
                      </button>
                      {user.id === currentUserId && <span className="text-xs text-amber-300">Tu cuenta</span>}
                    </div>
                  </td>
                </tr>
              ))}
              {usersSorted.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
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
