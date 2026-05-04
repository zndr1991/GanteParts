const FINANCE_MANAGE_ROLES = new Set(["admin", "supervisor", "operator"]);

export const canManageFinance = (role?: string | null) => {
  const normalized = (role ?? "").toLowerCase();
  return FINANCE_MANAGE_ROLES.has(normalized);
};

export const formatDateOnly = (date: Date) => date.toISOString().slice(0, 10);

export const parseDateOnlyInput = (value: unknown) => {
  const raw = (value ?? "").toString().trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }

  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() + 1 !== month ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }

  return parsed;
};

export const addUtcDays = (date: Date, days: number) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));

export const getWeekRangeUtc = (anchor: Date) => {
  const normalizedAnchor = new Date(
    Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate())
  );
  const weekDay = normalizedAnchor.getUTCDay();
  const mondayOffset = (weekDay + 6) % 7;
  const start = addUtcDays(normalizedAnchor, -mondayOffset);
  const endExclusive = addUtcDays(start, 7);
  const endInclusive = addUtcDays(start, 6);

  return {
    start,
    endExclusive,
    endInclusive
  };
};
