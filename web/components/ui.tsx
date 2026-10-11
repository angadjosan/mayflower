import type { VerdictType } from '../../worker/src/core/types';

const V: Record<VerdictType, { label: string; cls: string }> = {
  edge: { label: 'Edge', cls: 'bg-green-100 text-green-800' },
  priced_in: { label: 'Priced in', cls: 'bg-gray-100 text-gray-700' },
  against: { label: 'Against you', cls: 'bg-red-100 text-red-800' },
  no_market: { label: 'No market', cls: 'bg-slate-200 text-slate-700' },
};
export const verdictLabel = (t: VerdictType) => V[t].label;

export function VerdictBadge({ type }: { type: VerdictType }) {
  const v = V[type];
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${v.cls}`}>{v.label}</span>;
}

export function Badge({ children, tone = 'amber' }: { children: React.ReactNode; tone?: 'amber' | 'green' | 'gray' }) {
  const c = { amber: 'bg-amber-100 text-amber-800', green: 'bg-green-100 text-green-800', gray: 'bg-gray-100 text-gray-700' }[tone];
  return <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${c}`}>{children}</span>;
}

export function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5">
      {title && <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">{title}</h2>}
      {children}
    </section>
  );
}

export function Offline() {
  return (
    <div className="mx-auto max-w-xl py-24 text-center">
      <h1 className="text-2xl font-semibold">Worker offline</h1>
      <p className="mt-2 text-gray-500">
        Can&apos;t reach the Mayflower worker. Start it and this page will pick up on its own.
      </p>
    </div>
  );
}
