"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type EntryType = "income" | "expense";
type DebtMovementType = "charge" | "payment";

type FinanceEntry = {
  id: string;
  type: EntryType;
  date: string;
  concept: string;
  code: string | null;
  amount: number;
};

type DebtMovement = {
  id: string;
  debtId: string;
  type: DebtMovementType;
  concept: string;
  amount: number;
  date: string;
  createdAt: string;
};

type DebtSummary = {
  id: string;
  creditorName: string;
  concept: string;
  createdAt: string;
  totalCharge: number;
  totalPayment: number;
  balance: number;
  movements: DebtMovement[];
};

type FinanceData = {
  canManage: boolean;
  weekStart: string;
  weekEnd: string;
  entries: FinanceEntry[];
  totals: {
    income: number;
    expense: number;
    openingBalance: number;
    weeklyNet: number;
    balance: number;
  };
  debts: DebtSummary[];
  debtTotals: {
    charge: number;
    payment: number;
    balance: number;
  };
};

type MovementDraft = {
  concept: string;
  amount: string;
  date: string;
};

type DebtMovementDrafts = {
  charge: MovementDraft;
  payment: MovementDraft;
};

type FinanceClientProps = {
  userRole: string;
};

const moneyFormatter = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const todayDateInput = () => new Date().toISOString().slice(0, 10);

const formatMoney = (value: number) => moneyFormatter.format(value || 0);

const formatDateLabel = (value: string) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("es-MX", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  });
};

const shiftDateByDays = (dateInput: string, days: number) => {
  const [yearRaw, monthRaw, dayRaw] = dateInput.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return todayDateInput();
  }

  const shifted = new Date(Date.UTC(year, month - 1, day));
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
};

const parseAmountInput = (rawValue: string) => {
  const normalized = rawValue.replace(/[^0-9.-]/g, "").trim();
  if (!normalized.length) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed * 100) / 100;
};

const makeEmptyMovementDraft = (): MovementDraft => ({
  concept: "",
  amount: "",
  date: todayDateInput()
});

const makeInitialEntryForm = () => ({
  type: "income" as EntryType,
  date: todayDateInput(),
  concept: "",
  code: "",
  amount: ""
});

const makeInitialDebtForm = () => ({
  creditorName: "",
  concept: "",
  amount: "",
  date: todayDateInput()
});

export function FinanceClient({ userRole }: FinanceClientProps) {
  const [activeTab, setActiveTab] = useState<"cashflow" | "debts">("cashflow");
  const [weekAnchor, setWeekAnchor] = useState(todayDateInput());
  const [data, setData] = useState<FinanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [entryForm, setEntryForm] = useState(makeInitialEntryForm());
  const [debtForm, setDebtForm] = useState(makeInitialDebtForm());
  const [movementDrafts, setMovementDrafts] = useState<Record<string, DebtMovementDrafts>>({});

  const normalizedRole = (userRole ?? "").toLowerCase();
  const roleCanManage = normalizedRole === "admin" || normalizedRole === "supervisor" || normalizedRole === "operator";
  const canManage = data?.canManage ?? roleCanManage;

  const fetchFinanceData = useCallback(async (anchor: string, options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setLoading(true);
    }

    try {
      const params = new URLSearchParams({ week: anchor });
      const response = await fetch(`/api/finance?${params.toString()}`, { cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as FinanceData | { error?: string } | null;

      if (!response.ok) {
        const errorMessage =
          payload && typeof payload === "object" && "error" in payload
            ? (payload.error ?? "No se pudo cargar finanzas")
            : "No se pudo cargar finanzas";
        throw new Error(errorMessage);
      }

      setData(payload as FinanceData);
      setMessage(null);
    } catch (error: any) {
      setMessage(error?.message || "No se pudo cargar finanzas");
    } finally {
      if (!options?.silent) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void fetchFinanceData(weekAnchor);
  }, [fetchFinanceData, weekAnchor]);

  useEffect(() => {
    const debts = data?.debts ?? [];
    if (!debts.length) return;

    setMovementDrafts((current) => {
      let changed = false;
      const next: Record<string, DebtMovementDrafts> = { ...current };

      debts.forEach((debt) => {
        if (!next[debt.id]) {
          changed = true;
          next[debt.id] = {
            charge: makeEmptyMovementDraft(),
            payment: makeEmptyMovementDraft()
          };
        }
      });

      return changed ? next : current;
    });
  }, [data?.debts]);

  const weekRangeLabel = useMemo(() => {
    if (!data) return "";
    return `${formatDateLabel(data.weekStart)} - ${formatDateLabel(data.weekEnd)}`;
  }, [data]);

  const openingBalance = data?.totals.openingBalance ?? 0;
  const weeklyNet = data?.totals.weeklyNet ?? 0;

  const submitEntry = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!canManage) {
        setMessage("Tu rol no puede registrar movimientos financieros");
        return;
      }

      const concept = entryForm.concept.trim();
      if (!concept.length) {
        setMessage("Debes capturar el concepto");
        return;
      }

      const amount = parseAmountInput(entryForm.amount);
      if (!amount) {
        setMessage("Monto invalido");
        return;
      }

      setSubmitting(true);
      try {
        const response = await fetch("/api/finance/entries", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: entryForm.type,
            date: entryForm.date,
            concept,
            code: entryForm.code.trim() || null,
            amount
          })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || "No se pudo guardar el movimiento");
        }

        setEntryForm((current) => ({
          ...current,
          concept: "",
          code: "",
          amount: ""
        }));
        setMessage("Movimiento guardado");
        await fetchFinanceData(weekAnchor, { silent: true });
      } catch (error: any) {
        setMessage(error?.message || "No se pudo guardar el movimiento");
      } finally {
        setSubmitting(false);
      }
    },
    [canManage, entryForm, fetchFinanceData, weekAnchor]
  );

  const deleteEntry = useCallback(
    async (entryId: string) => {
      if (!canManage) return;
      if (!window.confirm("¿Eliminar este movimiento?")) return;

      setSubmitting(true);
      try {
        const response = await fetch("/api/finance/entries", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: entryId })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || "No se pudo eliminar el movimiento");
        }

        setMessage("Movimiento eliminado");
        await fetchFinanceData(weekAnchor, { silent: true });
      } catch (error: any) {
        setMessage(error?.message || "No se pudo eliminar el movimiento");
      } finally {
        setSubmitting(false);
      }
    },
    [canManage, fetchFinanceData, weekAnchor]
  );

  const submitDebt = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!canManage) {
        setMessage("Tu rol no puede registrar deudas");
        return;
      }

      const creditorName = debtForm.creditorName.trim();
      const concept = debtForm.concept.trim();
      const amount = parseAmountInput(debtForm.amount);

      if (!creditorName.length) {
        setMessage("Debes indicar a quien se le debe");
        return;
      }
      if (!concept.length) {
        setMessage("Debes capturar el concepto de la deuda");
        return;
      }
      if (!amount) {
        setMessage("Monto invalido para deuda");
        return;
      }

      setSubmitting(true);
      try {
        const response = await fetch("/api/finance/debts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            creditorName,
            concept,
            amount,
            date: debtForm.date
          })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || "No se pudo crear la deuda");
        }

        setDebtForm(makeInitialDebtForm());
        setMessage("Deuda registrada");
        await fetchFinanceData(weekAnchor, { silent: true });
      } catch (error: any) {
        setMessage(error?.message || "No se pudo crear la deuda");
      } finally {
        setSubmitting(false);
      }
    },
    [canManage, debtForm, fetchFinanceData, weekAnchor]
  );

  const deleteDebt = useCallback(
    async (debtId: string) => {
      if (!canManage) return;
      if (!window.confirm("¿Eliminar esta deuda completa y sus movimientos?")) return;

      setSubmitting(true);
      try {
        const response = await fetch("/api/finance/debts", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: debtId })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || "No se pudo eliminar la deuda");
        }

        setMessage("Deuda eliminada");
        await fetchFinanceData(weekAnchor, { silent: true });
      } catch (error: any) {
        setMessage(error?.message || "No se pudo eliminar la deuda");
      } finally {
        setSubmitting(false);
      }
    },
    [canManage, fetchFinanceData, weekAnchor]
  );

  const setMovementDraftField = useCallback(
    (debtId: string, type: DebtMovementType, field: keyof MovementDraft, value: string) => {
      setMovementDrafts((current) => {
        const existingDebtDraft =
          current[debtId] ?? {
            charge: makeEmptyMovementDraft(),
            payment: makeEmptyMovementDraft()
          };

        return {
          ...current,
          [debtId]: {
            ...existingDebtDraft,
            [type]: {
              ...existingDebtDraft[type],
              [field]: value
            }
          }
        };
      });
    },
    []
  );

  const submitDebtMovement = useCallback(
    async (debtId: string, type: DebtMovementType) => {
      if (!canManage) {
        setMessage("Tu rol no puede modificar deudas");
        return;
      }

      const draft = movementDrafts[debtId]?.[type] ?? makeEmptyMovementDraft();
      const concept = draft.concept.trim();
      const amount = parseAmountInput(draft.amount);

      if (!concept.length) {
        setMessage("Debes capturar el concepto del movimiento");
        return;
      }
      if (!amount) {
        setMessage("Monto invalido");
        return;
      }

      setSubmitting(true);
      try {
        const response = await fetch("/api/finance/debts/movements", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            debtId,
            type,
            concept,
            amount,
            date: draft.date
          })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || "No se pudo guardar el movimiento de deuda");
        }

        setMovementDrafts((current) => {
          const debtDraft =
            current[debtId] ?? {
              charge: makeEmptyMovementDraft(),
              payment: makeEmptyMovementDraft()
            };
          return {
            ...current,
            [debtId]: {
              ...debtDraft,
              [type]: makeEmptyMovementDraft()
            }
          };
        });

        setMessage(type === "payment" ? "Abono registrado" : "Cargo registrado");
        await fetchFinanceData(weekAnchor, { silent: true });
      } catch (error: any) {
        setMessage(error?.message || "No se pudo guardar el movimiento de deuda");
      } finally {
        setSubmitting(false);
      }
    },
    [canManage, fetchFinanceData, movementDrafts, weekAnchor]
  );

  const deleteDebtMovement = useCallback(
    async (movementId: string) => {
      if (!canManage) return;
      if (!window.confirm("¿Eliminar este movimiento de deuda?")) return;

      setSubmitting(true);
      try {
        const response = await fetch("/api/finance/debts/movements", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: movementId })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || "No se pudo eliminar el movimiento");
        }

        setMessage("Movimiento eliminado");
        await fetchFinanceData(weekAnchor, { silent: true });
      } catch (error: any) {
        setMessage(error?.message || "No se pudo eliminar el movimiento");
      } finally {
        setSubmitting(false);
      }
    },
    [canManage, fetchFinanceData, weekAnchor]
  );

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-slate-100 sm:px-6 sm:py-8">
      <div className="mx-auto flex max-w-screen-2xl flex-col gap-6">
        <header className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 shadow-sm sm:p-6">
          <p className="text-xs uppercase tracking-[0.3em] text-amber-400">Control semanal</p>
          <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold">Ingresos, egresos y deudas</h1>
              <p className="text-sm text-slate-300">
                Registra movimientos por semana y da seguimiento a deudas con abonos o cargos adicionales.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/panel"
                className="rounded-md border border-emerald-400/50 bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-100 hover:bg-emerald-500/20"
              >
                Volver al menu
              </Link>
              <Link
                href="/inventory"
                className="rounded-md border border-amber-400/50 bg-amber-500/10 px-3 py-2 text-sm font-semibold text-amber-100 hover:bg-amber-500/20"
              >
                Ir a inventario
              </Link>
              <a
                href="/api/auth/signout"
                className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:border-amber-400"
              >
                Cerrar sesion
              </a>
            </div>
          </div>
        </header>

        <section className="rounded-2xl border border-slate-700 bg-slate-900/70 p-4 shadow">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setWeekAnchor((current) => shiftDateByDays(current, -7))}
                className="rounded-md border border-slate-600 px-3 py-2 text-sm text-slate-100 hover:border-amber-400"
              >
                Semana anterior
              </button>
              <input
                type="date"
                value={weekAnchor}
                onChange={(event) => setWeekAnchor(event.target.value)}
                className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-amber-400 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setWeekAnchor((current) => shiftDateByDays(current, 7))}
                className="rounded-md border border-slate-600 px-3 py-2 text-sm text-slate-100 hover:border-amber-400"
              >
                Semana siguiente
              </button>
            </div>
            <div className="flex flex-col items-start gap-2 sm:items-end">
              <div className="inline-flex rounded-lg border border-slate-700 bg-slate-950/60 p-1">
                <button
                  type="button"
                  onClick={() => setActiveTab("cashflow")}
                  className={`rounded-md px-3 py-1.5 text-sm font-semibold ${
                    activeTab === "cashflow"
                      ? "bg-emerald-500/20 text-emerald-100"
                      : "text-slate-300 hover:text-slate-100"
                  }`}
                >
                  Ingresos y egresos
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("debts")}
                  className={`rounded-md px-3 py-1.5 text-sm font-semibold ${
                    activeTab === "debts" ? "bg-amber-500/20 text-amber-100" : "text-slate-300 hover:text-slate-100"
                  }`}
                >
                  Deudas
                </button>
              </div>
              {weekRangeLabel && <p className="text-xs text-slate-400">Semana activa: {weekRangeLabel}</p>}
            </div>
          </div>
        </section>

        {message && (
          <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            {message}
          </div>
        )}

        {loading && (
          <section className="rounded-2xl border border-slate-700 bg-slate-900/70 p-6 text-sm text-slate-300">
            Cargando datos financieros...
          </section>
        )}

        {!loading && data && activeTab === "cashflow" && (
          <section className="space-y-4 rounded-2xl border border-slate-700 bg-slate-900/70 p-4 shadow">
            <div className="grid gap-3 sm:grid-cols-3">
              <article className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-4">
                <p className="text-xs uppercase tracking-wide text-emerald-200">Ingresos</p>
                <p className="mt-2 text-2xl font-semibold text-emerald-100">{formatMoney(data.totals.income)}</p>
              </article>
              <article className="rounded-xl border border-rose-400/30 bg-rose-500/10 p-4">
                <p className="text-xs uppercase tracking-wide text-rose-200">Egresos</p>
                <p className="mt-2 text-2xl font-semibold text-rose-100">{formatMoney(data.totals.expense)}</p>
              </article>
              <article className="rounded-xl border border-cyan-400/30 bg-cyan-500/10 p-4">
                <p className="text-xs uppercase tracking-wide text-cyan-200">Balance semanal</p>
                <p className="mt-2 text-2xl font-semibold text-cyan-100">{formatMoney(data.totals.balance)}</p>
                <p className="mt-2 text-[11px] text-cyan-200/90">
                  Saldo inicial: {formatMoney(openingBalance)}
                </p>
                <p className="text-[11px] text-cyan-200/90">
                  Movimiento semana: {formatMoney(weeklyNet)}
                </p>
              </article>
            </div>

            <form className="grid grid-cols-1 gap-2 rounded-xl border border-slate-700 bg-slate-950/40 p-3 md:grid-cols-6" onSubmit={submitEntry}>
              <select
                value={entryForm.type}
                onChange={(event) => setEntryForm((current) => ({ ...current, type: event.target.value as EntryType }))}
                className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                disabled={!canManage || submitting}
              >
                <option value="income">Ingreso</option>
                <option value="expense">Egreso</option>
              </select>
              <input
                type="date"
                value={entryForm.date}
                onChange={(event) => setEntryForm((current) => ({ ...current, date: event.target.value }))}
                className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                disabled={!canManage || submitting}
                required
              />
              <input
                type="text"
                placeholder="Concepto"
                value={entryForm.concept}
                onChange={(event) => setEntryForm((current) => ({ ...current, concept: event.target.value }))}
                className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm md:col-span-2"
                disabled={!canManage || submitting}
                required
              />
              <input
                type="text"
                placeholder="Codigo"
                value={entryForm.code}
                onChange={(event) => setEntryForm((current) => ({ ...current, code: event.target.value }))}
                className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                disabled={!canManage || submitting}
              />
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Monto"
                  value={entryForm.amount}
                  onChange={(event) => setEntryForm((current) => ({ ...current, amount: event.target.value }))}
                  className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                  disabled={!canManage || submitting}
                  required
                />
                <button
                  type="submit"
                  disabled={!canManage || submitting}
                  className="rounded-md border border-emerald-400/50 bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-100 hover:bg-emerald-500/20 disabled:opacity-50"
                >
                  Agregar
                </button>
              </div>
            </form>

            <div className="overflow-x-auto rounded-xl border border-slate-700">
              <table className="min-w-[860px] w-full border-collapse text-sm">
                <thead className="bg-slate-900/80 text-left text-xs uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="px-3 py-2">Fecha</th>
                    <th className="px-3 py-2">Concepto</th>
                    <th className="px-3 py-2">Codigo</th>
                    <th className="px-3 py-2 text-right">Ingreso</th>
                    <th className="px-3 py-2 text-right">Egreso</th>
                    <th className="px-3 py-2 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {data.entries.length ? (
                    data.entries.map((entry) => (
                      <tr key={entry.id} className="border-t border-slate-800 text-slate-200">
                        <td className="px-3 py-2">{formatDateLabel(entry.date)}</td>
                        <td className="px-3 py-2">{entry.concept}</td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-300">{entry.code || "-"}</td>
                        <td className="px-3 py-2 text-right font-semibold text-emerald-200">
                          {entry.type === "income" ? `+${formatMoney(entry.amount)}` : "-"}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold text-rose-200">
                          {entry.type === "expense" ? `-${formatMoney(entry.amount)}` : "-"}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {canManage ? (
                            <button
                              type="button"
                              onClick={() => void deleteEntry(entry.id)}
                              disabled={submitting}
                              className="rounded-md border border-rose-400/40 px-2 py-1 text-xs text-rose-200 hover:bg-rose-500/10 disabled:opacity-50"
                            >
                              Quitar
                            </button>
                          ) : (
                            <span className="text-xs text-slate-500">Solo lectura</span>
                          )}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="px-3 py-6 text-center text-sm text-slate-400" colSpan={6}>
                        No hay movimientos registrados para esta semana.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {!loading && data && activeTab === "debts" && (
          <section className="space-y-4 rounded-2xl border border-slate-700 bg-slate-900/70 p-4 shadow">
            <div className="grid gap-3 sm:grid-cols-3">
              <article className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-4">
                <p className="text-xs uppercase tracking-wide text-amber-200">Total cargos</p>
                <p className="mt-2 text-2xl font-semibold text-amber-100">{formatMoney(data.debtTotals.charge)}</p>
              </article>
              <article className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-4">
                <p className="text-xs uppercase tracking-wide text-emerald-200">Total abonos</p>
                <p className="mt-2 text-2xl font-semibold text-emerald-100">{formatMoney(data.debtTotals.payment)}</p>
              </article>
              <article className="rounded-xl border border-rose-400/30 bg-rose-500/10 p-4">
                <p className="text-xs uppercase tracking-wide text-rose-200">Saldo pendiente</p>
                <p className="mt-2 text-2xl font-semibold text-rose-100">{formatMoney(data.debtTotals.balance)}</p>
              </article>
            </div>

            <form className="grid grid-cols-1 gap-2 rounded-xl border border-slate-700 bg-slate-950/40 p-3 md:grid-cols-5" onSubmit={submitDebt}>
              <input
                type="text"
                placeholder="A quien se le debe"
                value={debtForm.creditorName}
                onChange={(event) => setDebtForm((current) => ({ ...current, creditorName: event.target.value }))}
                className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                disabled={!canManage || submitting}
                required
              />
              <input
                type="text"
                placeholder="Concepto"
                value={debtForm.concept}
                onChange={(event) => setDebtForm((current) => ({ ...current, concept: event.target.value }))}
                className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm md:col-span-2"
                disabled={!canManage || submitting}
                required
              />
              <input
                type="text"
                placeholder="Monto inicial"
                value={debtForm.amount}
                onChange={(event) => setDebtForm((current) => ({ ...current, amount: event.target.value }))}
                className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                disabled={!canManage || submitting}
                required
              />
              <div className="flex gap-2">
                <input
                  type="date"
                  value={debtForm.date}
                  onChange={(event) => setDebtForm((current) => ({ ...current, date: event.target.value }))}
                  className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                  disabled={!canManage || submitting}
                  required
                />
                <button
                  type="submit"
                  disabled={!canManage || submitting}
                  className="rounded-md border border-amber-400/50 bg-amber-500/10 px-3 py-2 text-sm font-semibold text-amber-100 hover:bg-amber-500/20 disabled:opacity-50"
                >
                  Crear
                </button>
              </div>
            </form>

            {data.debts.length ? (
              <div className="space-y-4">
                {data.debts.map((debt) => {
                  const drafts =
                    movementDrafts[debt.id] ??
                    ({
                      charge: makeEmptyMovementDraft(),
                      payment: makeEmptyMovementDraft()
                    } satisfies DebtMovementDrafts);

                  return (
                    <article key={debt.id} className="rounded-xl border border-slate-700 bg-slate-950/40 p-4 space-y-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <h3 className="text-lg font-semibold text-slate-100">{debt.creditorName}</h3>
                          <p className="text-sm text-slate-300">{debt.concept}</p>
                          <p className="text-xs text-slate-500">Creada: {new Date(debt.createdAt).toLocaleString("es-MX")}</p>
                        </div>
                        {canManage && (
                          <button
                            type="button"
                            onClick={() => void deleteDebt(debt.id)}
                            disabled={submitting}
                            className="rounded-md border border-rose-400/40 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-rose-200 hover:bg-rose-500/10 disabled:opacity-50"
                          >
                            Eliminar deuda
                          </button>
                        )}
                      </div>

                      <div className="grid gap-2 sm:grid-cols-3">
                        <div className="rounded-md border border-amber-400/30 bg-amber-500/10 px-3 py-2">
                          <p className="text-[11px] uppercase tracking-wide text-amber-200">Cargos</p>
                          <p className="text-lg font-semibold text-amber-100">{formatMoney(debt.totalCharge)}</p>
                        </div>
                        <div className="rounded-md border border-emerald-400/30 bg-emerald-500/10 px-3 py-2">
                          <p className="text-[11px] uppercase tracking-wide text-emerald-200">Abonos</p>
                          <p className="text-lg font-semibold text-emerald-100">{formatMoney(debt.totalPayment)}</p>
                        </div>
                        <div className="rounded-md border border-rose-400/30 bg-rose-500/10 px-3 py-2">
                          <p className="text-[11px] uppercase tracking-wide text-rose-200">Saldo</p>
                          <p className="text-lg font-semibold text-rose-100">{formatMoney(debt.balance)}</p>
                        </div>
                      </div>

                      {canManage && (
                        <div className="grid gap-3 lg:grid-cols-2">
                          <div className="rounded-md border border-slate-700 bg-slate-900/70 p-3 space-y-2">
                            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-200">Agregar abono</p>
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                              <input
                                type="text"
                                placeholder="Concepto"
                                value={drafts.payment.concept}
                                onChange={(event) =>
                                  setMovementDraftField(debt.id, "payment", "concept", event.target.value)
                                }
                                className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs sm:col-span-2"
                              />
                              <input
                                type="text"
                                placeholder="Monto"
                                value={drafts.payment.amount}
                                onChange={(event) =>
                                  setMovementDraftField(debt.id, "payment", "amount", event.target.value)
                                }
                                className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs"
                              />
                              <input
                                type="date"
                                value={drafts.payment.date}
                                onChange={(event) =>
                                  setMovementDraftField(debt.id, "payment", "date", event.target.value)
                                }
                                className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs"
                              />
                              <button
                                type="button"
                                onClick={() => void submitDebtMovement(debt.id, "payment")}
                                disabled={submitting}
                                className="rounded-md border border-emerald-400/50 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-100 hover:bg-emerald-500/20 disabled:opacity-50 sm:col-span-2"
                              >
                                Guardar abono
                              </button>
                            </div>
                          </div>

                          <div className="rounded-md border border-slate-700 bg-slate-900/70 p-3 space-y-2">
                            <p className="text-xs font-semibold uppercase tracking-wide text-amber-200">Agregar cargo</p>
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                              <input
                                type="text"
                                placeholder="Concepto"
                                value={drafts.charge.concept}
                                onChange={(event) => setMovementDraftField(debt.id, "charge", "concept", event.target.value)}
                                className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs sm:col-span-2"
                              />
                              <input
                                type="text"
                                placeholder="Monto"
                                value={drafts.charge.amount}
                                onChange={(event) => setMovementDraftField(debt.id, "charge", "amount", event.target.value)}
                                className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs"
                              />
                              <input
                                type="date"
                                value={drafts.charge.date}
                                onChange={(event) => setMovementDraftField(debt.id, "charge", "date", event.target.value)}
                                className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs"
                              />
                              <button
                                type="button"
                                onClick={() => void submitDebtMovement(debt.id, "charge")}
                                disabled={submitting}
                                className="rounded-md border border-amber-400/50 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-100 hover:bg-amber-500/20 disabled:opacity-50 sm:col-span-2"
                              >
                                Guardar cargo
                              </button>
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="overflow-x-auto rounded-lg border border-slate-800">
                        <table className="min-w-[640px] w-full border-collapse text-xs">
                          <thead className="bg-slate-900/80 text-left uppercase tracking-wide text-slate-400">
                            <tr>
                              <th className="px-3 py-2">Fecha</th>
                              <th className="px-3 py-2">Tipo</th>
                              <th className="px-3 py-2">Concepto</th>
                              <th className="px-3 py-2 text-right">Monto</th>
                              <th className="px-3 py-2 text-right">Acciones</th>
                            </tr>
                          </thead>
                          <tbody>
                            {debt.movements.length ? (
                              debt.movements.map((movement) => (
                                <tr key={movement.id} className="border-t border-slate-800 text-slate-200">
                                  <td className="px-3 py-2">{formatDateLabel(movement.date)}</td>
                                  <td className="px-3 py-2">
                                    <span
                                      className={`rounded-full border px-2 py-0.5 text-[10px] ${
                                        movement.type === "payment"
                                          ? "border-emerald-400/50 text-emerald-200"
                                          : "border-amber-400/50 text-amber-200"
                                      }`}
                                    >
                                      {movement.type === "payment" ? "Abono" : "Cargo"}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2">{movement.concept}</td>
                                  <td className="px-3 py-2 text-right font-semibold">
                                    <span
                                      className={
                                        movement.type === "payment" ? "text-emerald-200" : "text-amber-200"
                                      }
                                    >
                                      {movement.type === "payment" ? "-" : "+"}
                                      {formatMoney(movement.amount)}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2 text-right">
                                    {canManage ? (
                                      <button
                                        type="button"
                                        onClick={() => void deleteDebtMovement(movement.id)}
                                        disabled={submitting}
                                        className="rounded-md border border-rose-400/40 px-2 py-1 text-[10px] text-rose-200 hover:bg-rose-500/10 disabled:opacity-50"
                                      >
                                        Quitar
                                      </button>
                                    ) : (
                                      <span className="text-[10px] text-slate-500">Solo lectura</span>
                                    )}
                                  </td>
                                </tr>
                              ))
                            ) : (
                              <tr>
                                <td className="px-3 py-4 text-center text-slate-400" colSpan={5}>
                                  Esta deuda no tiene movimientos.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-xl border border-slate-700 bg-slate-950/30 p-5 text-sm text-slate-400">
                No hay deudas registradas por el momento.
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
