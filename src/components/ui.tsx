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
export const pnlClass = (n: number) => (n > 0 ? "text-money-600" : n < 0 ? "text-rose-500" : "text-stone-500");
export const signedUsd = (n: number) => `${n > 0 ? "+" : ""}${usd(n)}`;

export function Card({ title, action, children, className = "" }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`animate-rise rounded-3xl bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.08)] ${className}`}>
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 className="text-[17px] font-bold tracking-tight text-stone-900">{title}</h2>}
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
    primary: "bg-money-600 text-white hover:bg-money-700 border-transparent shadow-[0_6px_16px_-8px_rgba(0,166,62,0.7)]",
    outline: "bg-stone-100 text-stone-800 border-transparent hover:bg-stone-200",
    ghost: "bg-transparent text-imsg border-transparent hover:bg-imsg/10",
    danger: "bg-rose-50 text-rose-600 border-transparent hover:bg-rose-100",
  }[variant];
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-1.5 rounded-full border px-4 py-2 text-sm font-semibold transition-all duration-150 hover:-translate-y-px active:translate-y-0 active:scale-95 disabled:pointer-events-none disabled:opacity-40 ${styles} ${className}`}
    />
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "accent" | "warn" | "good" }) {
  const styles = {
    neutral: "bg-stone-100 text-stone-600",
    accent: "bg-imsg/10 text-imsg-dark",
    warn: "bg-amber-50 text-amber-700",
    good: "bg-money-50 text-money-700",
  }[tone];
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${styles}`}>{children}</span>;
}

export function Stat({ label, value, className = "" }: { label: string; value: ReactNode; className?: string }) {
  return (
    <div>
      <div className="text-xs font-medium text-stone-500">{label}</div>
      <div className={`mt-0.5 text-lg font-bold tabular-nums tracking-tight ${className}`}>{value}</div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl bg-stone-50 px-4 py-8 text-center text-sm text-stone-500">{children}</div>;
}

export function Sparkline({ points, width = 280, height = 56 }: { points: number[]; width?: number; height?: number }) {
  if (points.length < 2) return <div className="text-xs text-stone-400">Not enough history yet.</div>;
  const min = Math.min(...points), max = Math.max(...points);
  const span = max - min || 1;
  const xy = points.map((v, i) => [(i / (points.length - 1)) * width, height - 4 - ((v - min) / span) * (height - 8)]);
  const d = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const up = points[points.length - 1] >= points[0];
  const color = up ? "#00a63e" : "#f43f5e";
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-14 w-full" preserveAspectRatio="none" aria-label="Portfolio value history">
      <path d={`${d} L${width},${height} L0,${height} Z`} fill={color} opacity={0.12} />
      <path d={d} fill="none" stroke={color} strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function CitationLink({ c }: { c: { title: string; url: string; publishedAt?: string } }) {
  return (
    <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-imsg underline decoration-imsg/30 underline-offset-2 hover:decoration-imsg">
      {c.title}
      {c.publishedAt ? <span className="text-stone-400 no-underline"> · {date(c.publishedAt)}</span> : null}
    </a>
  );
}

/** iOS-style switch. `on` reads as green, like Settings. */
export function Toggle({ on, onChange, disabled, label }: { on: boolean; onChange: () => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onChange}
      disabled={disabled}
      className={`relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors duration-200 disabled:opacity-50 ${on ? "bg-money-500" : "bg-stone-300"}`}
    >
      <span
        className={`absolute left-[2px] top-[2px] h-[27px] w-[27px] rounded-full bg-white shadow-[0_3px_8px_rgba(0,0,0,0.15),0_1px_1px_rgba(0,0,0,0.16)] transition-transform duration-200 ${on ? "translate-x-5" : ""}`}
      />
    </button>
  );
}

/** Round avatar used for Mayflower in the header, chat, and login. */
export function Logo({ size = 36 }: { size?: number }) {
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-money-400 to-money-700 font-bold text-white shadow-[0_4px_12px_-4px_rgba(0,166,62,0.6)]"
      style={{ width: size, height: size, fontSize: size * 0.45 }}
      aria-hidden
    >
      M
    </div>
  );
}
