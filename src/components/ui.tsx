"use client";
import type { ReactNode } from "react";

export const usd = (n: number | undefined | null, digits = 2) =>
  n == null || Number.isNaN(n)
    ? "—"
    : n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits });
export const pct = (p: number | undefined | null) => (p == null || Number.isNaN(p) ? "—" : `${Math.round(p * 100)}%`);
export const cents = (p: number | undefined | null) => (p == null ? "—" : `${Math.round(p * 100)}¢`);
export const date = (s?: string) => (s ? new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—");
export const time = (s?: string) => (s ? new Date(s).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");
export const pnlClass = (n: number) => (n > 0 ? "text-emerald-600" : n < 0 ? "text-rose-600" : "text-stone-500");
export const signedUsd = (n: number) => `${n > 0 ? "+" : ""}${usd(n)}`;

export function Card({ title, action, children, className = "" }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-stone-200 bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] ${className}`}>
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 className="text-[15px] font-semibold tracking-tight text-stone-900">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "outline" | "danger" };
export function Button({ variant = "outline", className = "", ...props }: BtnProps) {
  const styles = {
    primary: "bg-indigo-600 text-white hover:bg-indigo-700 border-transparent",
    outline: "bg-white text-stone-700 border-stone-200 hover:bg-stone-50",
    ghost: "bg-transparent text-stone-600 border-transparent hover:bg-stone-100",
    danger: "bg-white text-rose-600 border-rose-200 hover:bg-rose-50",
  }[variant];
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}
    />
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "accent" | "warn" | "good" }) {
  const styles = {
    neutral: "bg-stone-100 text-stone-600",
    accent: "bg-indigo-50 text-indigo-700",
    warn: "bg-amber-50 text-amber-700",
    good: "bg-emerald-50 text-emerald-700",
  }[tone];
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${styles}`}>{children}</span>;
}

export function Stat({ label, value, className = "" }: { label: string; value: ReactNode; className?: string }) {
  return (
    <div>
      <div className="text-xs text-stone-500">{label}</div>
      <div className={`mt-0.5 text-lg font-semibold tabular-nums tracking-tight ${className}`}>{value}</div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-stone-200 px-4 py-8 text-center text-sm text-stone-500">{children}</div>;
}

export function Sparkline({ points, width = 280, height = 56 }: { points: number[]; width?: number; height?: number }) {
  if (points.length < 2) return <div className="text-xs text-stone-400">Not enough history yet.</div>;
  const min = Math.min(...points), max = Math.max(...points);
  const span = max - min || 1;
  const xy = points.map((v, i) => [(i / (points.length - 1)) * width, height - 4 - ((v - min) / span) * (height - 8)]);
  const d = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const up = points[points.length - 1] >= points[0];
  const color = up ? "#4f46e5" : "#e11d48";
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-14 w-full" preserveAspectRatio="none" aria-label="Portfolio value history">
      <path d={`${d} L${width},${height} L0,${height} Z`} fill={color} opacity={0.08} />
      <path d={d} fill="none" stroke={color} strokeWidth={1.75} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function CitationLink({ c }: { c: { title: string; url: string; publishedAt?: string } }) {
  return (
    <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-indigo-600 underline decoration-indigo-200 underline-offset-2 hover:decoration-indigo-600">
      {c.title}
      {c.publishedAt ? <span className="text-stone-400 no-underline"> · {date(c.publishedAt)}</span> : null}
    </a>
  );
}
