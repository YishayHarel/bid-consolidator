export const money = (n: number | null | undefined, dp = 2) =>
  n == null || !Number.isFinite(n) ? '—' : `$${n.toFixed(dp)}`;

export const pct = (n: number | null | undefined, dp = 1) =>
  n == null || !Number.isFinite(n) ? '—' : `${n.toFixed(dp)}%`;

export const int = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString());

export const date = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

export const dateTime = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';

/** For <input> values: null/undefined → ''. */
export const field = (v: number | string | null | undefined) => (v == null ? '' : String(v));

/** From an <input> value to an API number: '' → null. */
export const toNum = (v: string): number | null => {
  const t = v.trim().replace(/[$,]/g, '');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

export const DIVISIONS = ['Hydration', 'Pet Beauty', 'Hard Coolers', 'Soft Coolers', 'Kitchen', 'General'];
