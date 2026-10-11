"use client";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from "recharts";

/** Minimal exposure-by-theme bar (Recharts). P&L-over-time arrives once we store periodic snapshots. */
export function ExposureChart({ data }: { data: Array<{ theme: string; atRisk: number }> }) {
  if (!data.length) return <div className="text-sm text-muted">No exposure yet.</div>;
  return (
    <div className="h-40">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
          <XAxis dataKey="theme" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} width={36} />
          <Tooltip formatter={(v) => [`$${Number(v).toFixed(2)}`, "At risk"]} />
          <Bar dataKey="atRisk" radius={[4, 4, 0, 0]}>{data.map((_, i) => <Cell key={i} fill="var(--accent)" />)}</Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
