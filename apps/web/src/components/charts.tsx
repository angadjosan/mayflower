"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatPct, formatUsd } from "@mayflower/shared";

export interface ValuePoint {
  ts: string;
  value: number;
}

function TooltipBody({ active, payload }: { active?: boolean; payload?: { payload: ValuePoint }[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-sm">
      <div className="tabular text-sm font-semibold text-text">{formatUsd(p.value)}</div>
      <div className="mt-0.5 flex items-center gap-1.5 text-muted">
        <span className="inline-block h-0.5 w-3 rounded" style={{ background: "var(--chart-1)" }} />
        {new Date(p.ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
      </div>
    </div>
  );
}

/** Portfolio value over time: one series, one axis, crosshair tooltip. */
export function ValueChart({ points }: { points: ValuePoint[] }) {
  if (points.length < 2) {
    return <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted">Not enough history yet — snapshots are taken as Mayflower monitors your portfolio.</div>;
  }
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = Math.max(1, (max - min) * 0.15);
  return (
    <div>
      <div className="h-44" role="img" aria-label={`Portfolio value from ${formatUsd(points[0].value)} to ${formatUsd(points[points.length - 1].value)}`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis
              dataKey="ts"
              tickFormatter={(t: string) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              tick={{ fontSize: 11, fill: "var(--muted)" }}
              axisLine={false}
              tickLine={false}
              minTickGap={40}
            />
            <YAxis
              domain={[Math.floor(min - pad), Math.ceil(max + pad)]}
              tickFormatter={(v: number) => `$${Math.round(v)}`}
              tick={{ fontSize: 11, fill: "var(--muted)" }}
              axisLine={false}
              tickLine={false}
              width={48}
            />
            <Tooltip content={<TooltipBody />} cursor={{ stroke: "var(--muted)", strokeWidth: 1 }} />
            <Line type="monotone" dataKey="value" stroke="var(--chart-1)" strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <details className="mt-2 text-xs text-muted">
        <summary className="cursor-pointer">Show data table</summary>
        <table className="tabular mt-2 w-full text-left">
          <thead>
            <tr>
              <th className="py-1 font-medium">Time</th>
              <th className="py-1 text-right font-medium">Value</th>
            </tr>
          </thead>
          <tbody>
            {points.slice(-30).map((p) => (
              <tr key={p.ts} className="border-t border-border">
                <td className="py-1">{new Date(p.ts).toLocaleString()}</td>
                <td className="py-1 text-right text-text">{formatUsd(p.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

/** Share of risk capacity by theme: single-hue bars, values labelled directly. */
export function ConcentrationBars({ items }: { items: { label: string; atRisk: number; share: number; positions: number }[] }) {
  if (items.length === 0) return <div className="text-sm text-muted">Nothing at risk.</div>;
  const maxShare = Math.max(...items.map((i) => i.share), 0.01);
  return (
    <ul className="space-y-2.5">
      {items.map((i) => (
        <li key={i.label} className="text-sm" title={`${i.label}: ${formatUsd(i.atRisk)} at risk, ${formatPct(i.share)} of your risk limit, ${i.positions} position(s)`}>
          <div className="flex items-baseline justify-between gap-2">
            <span>{i.label}</span>
            <span className="tabular text-xs text-muted">
              {formatUsd(i.atRisk)} · {formatPct(i.share)}
            </span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-surface-2">
            <div className="h-2 rounded-full" style={{ width: `${Math.max(2, (i.share / maxShare) * 100)}%`, background: "var(--chart-1)" }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
