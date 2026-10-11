import type { OverviewResponse, CaseResponse } from '../worker/src/core/api';

const BASE = process.env.WORKER_URL ?? 'http://localhost:8787';

async function get<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(`${BASE}${path}`, { cache: 'no-store' });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

export const getOverview = () => get<OverviewResponse>('/api/overview');
export const getCase = (id: string) => get<CaseResponse>(`/api/cases/${encodeURIComponent(id)}`);

export const pct = (n: number | null | undefined) => (n == null ? '—' : `${(n * 100).toFixed(1)}%`);
export const usd = (n: number | null | undefined) =>
  n == null ? '—' : `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(2)}`;
export const num = (v: unknown, f: (n: number) => string) =>
  typeof v === 'number' && Number.isFinite(v) ? f(v) : '—';
export const when = (s: string | null | undefined) => (s ? new Date(s).toLocaleString() : '—');
