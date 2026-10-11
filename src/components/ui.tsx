"use client";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./icons";

// ---------- Formatting ----------

export const usd = (n: number | undefined | null, digits = 2) =>
  n == null || Number.isNaN(n)
    ? "—"
    : n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits });
/** Compact dollars for tight spots: $1.2k, $98.4k. */
export const usdCompact = (n: number | undefined | null) =>
  n == null || Number.isNaN(n)
    ? "—"
    : Math.abs(n) >= 1000
      ? `${n < 0 ? "-" : ""}$${(Math.abs(n) / 1000).toFixed(Math.abs(n) >= 100_000 ? 0 : 1)}k`
      : usd(n, Number.isInteger(n) || Math.abs(n) >= 100 ? 0 : 2);
export const pct = (p: number | undefined | null) => (p == null || Number.isNaN(p) ? "—" : `${Math.round(p * 100)}%`);
export const signedPct = (p: number | undefined | null, digits = 2) =>
  p == null || Number.isNaN(p) || !Number.isFinite(p) ? "—" : `${p > 0 ? "+" : p < 0 ? "−" : ""}${Math.abs(p * 100).toFixed(digits)}%`;
export const cents = (p: number | undefined | null) => (p == null ? "—" : `${Math.round(p * 100)}¢`);
export const date = (s?: string) => (s ? new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—");
export const shortDate = (s?: string) => (s ? new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—");
export const time = (s?: string) => (s ? new Date(s).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");
export const pnlClass = (n: number) => (n > 0 ? "text-up" : n < 0 ? "text-down" : "text-muted");
export const signedUsd = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${usd(Math.abs(n))}`;

/** Relative "in 3d" / "2h ago". */
export function relTime(s?: string) {
  if (!s) return "—";
  const ms = new Date(s).getTime() - Date.now();
  const abs = Math.abs(ms);
  const unit = abs < 3_600_000 ? [60_000, "m"] : abs < 86_400_000 ? [3_600_000, "h"] : [86_400_000, "d"];
  const v = Math.max(1, Math.round(abs / (unit[0] as number)));
  return ms >= 0 ? `in ${v}${unit[1]}` : `${v}${unit[1]} ago`;
}

// ---------- Primitives ----------

export function Card({ title, action, children, className = "", pad = true }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={`rounded-2xl border border-line bg-surface shadow-card ${pad ? "p-5 sm:p-6" : ""} ${className}`}>
      {(title || action) && (
        <div className={`flex items-center justify-between gap-3 ${pad ? "mb-4" : "px-5 pb-3 pt-5 sm:px-6"}`}>
          {title && <h2 className="text-[15px] font-semibold tracking-tight text-fg">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/** Section heading outside a card: title + optional count + right-aligned action. */
export function SectionHead({ title, count, action, sub }: { title: string; count?: number; action?: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-fg">
          {title}
          {count != null && count > 0 && <span className="num rounded-full bg-sunken px-2 py-0.5 text-xs font-medium text-muted">{count}</span>}
        </h2>
        {sub && <p className="mt-0.5 text-[13px] text-muted">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "outline" | "danger" | "accent"; size?: "sm" | "md" };
export function Button({ variant = "outline", size = "md", className = "", ...props }: BtnProps) {
  const styles = {
    primary: "bg-ink text-ink-fg border-transparent hover:opacity-90",
    accent: "bg-accent text-accent-fg border-transparent hover:opacity-90",
    outline: "bg-surface text-fg border-line-strong hover:bg-sunken",
    ghost: "bg-transparent text-fg-2 border-transparent hover:bg-sunken hover:text-fg",
    danger: "bg-transparent text-down border-line-strong hover:bg-down-soft",
  }[variant];
  const sizes = size === "sm" ? "h-8 px-3 text-[13px]" : "h-10 px-4 text-sm";
  return (
    <button
      {...props}
      className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full border font-medium transition-[background-color,opacity,transform] duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 ${sizes} ${styles} ${className}`}
    />
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "accent" | "warn" | "good" | "bad" }) {
  const styles = {
    neutral: "bg-sunken text-muted",
    accent: "bg-accent-soft text-accent",
    warn: "bg-warn-soft text-warn",
    good: "bg-up-soft text-up",
    bad: "bg-down-soft text-down",
  }[tone];
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium ${styles}`}>{children}</span>;
}

export function Stat({ label, value, className = "", hint }: { label: string; value: ReactNode; className?: string; hint?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted">{label}</div>
      <div className={`num mt-1 text-base font-semibold text-fg ${className}`}>{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-subtle">{hint}</div>}
    </div>
  );
}

export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-line-strong px-5 py-10 text-center">
      <div className="mx-auto max-w-sm text-sm leading-relaxed text-muted">{children}</div>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

/** Tiny inline trend line (ticker strip). Color follows direction. */
export function Sparkline({ points, width = 56, height = 18, className = "h-[18px] w-14" }: { points: number[]; width?: number; height?: number; className?: string }) {
  if (points.length < 2) return null;
  const min = Math.min(...points), max = Math.max(...points);
  const span = max - min || 1;
  const d = points
    .map((v, i) => `${i ? "L" : "M"}${((i / (points.length - 1)) * width).toFixed(1)},${(height - 2 - ((v - min) / span) * (height - 4)).toFixed(1)}`)
    .join(" ");
  const up = points[points.length - 1] >= points[0];
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={className} preserveAspectRatio="none" aria-hidden>
      <path d={d} fill="none" stroke={up ? "var(--up)" : "var(--down)"} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function CitationLink({ c }: { c: { title: string; url: string; publishedAt?: string } }) {
  return (
    <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-fg-2 underline decoration-line-strong underline-offset-[3px] transition-colors hover:text-accent hover:decoration-accent">
      {c.title}
      {c.publishedAt ? <span className="text-subtle no-underline"> · {shortDate(c.publishedAt)}</span> : null}
    </a>
  );
}

export function Toggle({ on, onChange, disabled, label }: { on: boolean; onChange: () => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onChange}
      disabled={disabled}
      className={`relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors duration-200 disabled:opacity-50 ${on ? "bg-accent" : "bg-line-strong"}`}
    >
      <span className={`absolute left-[2px] top-[2px] h-[18px] w-[18px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.25)] transition-transform duration-200 ${on ? "translate-x-4" : ""}`} />
    </button>
  );
}

/** Mayflower mark (public/logo-512.png). */
export function Logo({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/logo-512.png" alt="" width={size} height={size} className={`shrink-0 rounded-[22%] ${className}`} style={{ width: size, height: size }} aria-hidden />
  );
}

export function VenueBadge({ venue }: { venue?: string }) {
  const v = venue === "hyperliquid" ? "Hyperliquid" : venue === "polymarket" ? "Polymarket" : "Gemini";
  const dot = venue === "hyperliquid" ? "bg-[#50e3c2]" : venue === "polymarket" ? "bg-[#2e5cff]" : "bg-accent";
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-line px-1.5 py-0.5 text-[11px] font-medium text-fg-2">
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden />
      {v}
    </span>
  );
}

export function SideTag({ side }: { side: "YES" | "NO" }) {
  return (
    <span className={`inline-flex h-5 items-center rounded px-1.5 text-[11px] font-semibold tracking-wide ${side === "YES" ? "bg-up-soft text-up" : "bg-down-soft text-down"}`}>
      {side}
    </span>
  );
}

export function TestnetPill({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border border-warn/30 bg-warn-soft px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-[0.06em] text-warn ${className}`}>
      <span className="h-1 w-1 rounded-full bg-warn" aria-hidden />
      Testnet
    </span>
  );
}

export const IMESSAGE_ADDRESS = "ohtakekai@gmail.com";
/** sms: link that opens Messages to Mayflower, optionally prefilled. */
export const smsHref = (body?: string) => `sms:${IMESSAGE_ADDRESS}${body ? `?&body=${encodeURIComponent(body)}` : ""}`;

export function MessageIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="currentColor" aria-hidden>
      <path d="M10 2.5c-4.42 0-8 2.98-8 6.66 0 2.1 1.17 3.97 3 5.19-.1.98-.53 2.03-1.34 2.9a.4.4 0 0 0 .32.67c1.66-.08 3.03-.73 3.98-1.42.65.14 1.33.21 2.04.21 4.42 0 8-2.98 8-6.66S14.42 2.5 10 2.5Z" />
    </svg>
  );
}

export function Chevron({ open, className = "h-4 w-4" }: { open?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={`${className} transition-transform duration-200 ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden>
      <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ---------- Widgets ----------

/** Circular gauge. `value` is 0..1. Center content is up to the caller. */
export function Ring({
  value, size = 56, stroke = 5, color = "var(--fg)", track = "var(--sunken)", children, label,
}: { value: number; size?: number; stroke?: number; color?: string; track?: string; children?: ReactNode; label?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role={label ? "img" : undefined} aria-label={label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - v)} className="transition-[stroke-dashoffset] duration-700"
        />
      </svg>
      {children && <div className="absolute inset-0 flex items-center justify-center">{children}</div>}
    </div>
  );
}

/** Small rounded chip for values: "$46", "+17 pts", "Simulated". */
export function Chip({ children, tone = "neutral", className = "", title }: { children: ReactNode; tone?: "neutral" | "up" | "down" | "accent" | "warn" | "solid"; className?: string; title?: string }) {
  const styles = {
    neutral: "bg-sunken text-fg-2",
    up: "bg-up-soft text-up",
    down: "bg-down-soft text-down",
    accent: "bg-accent-soft text-accent",
    warn: "bg-warn-soft text-warn",
    solid: "bg-ink text-ink-fg",
  }[tone];
  return <span title={title} className={`num inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full px-2 text-xs font-medium ${styles} ${className}`}>{children}</span>;
}

export const pnlTone = (n: number) => (n > 0 ? "up" : n < 0 ? "down" : "neutral") as "up" | "down" | "neutral";

/** Honest label for anything that will not touch a real test venue. */
export function SimulatedChip() {
  return <Chip tone="warn" title="Simulated: no order reaches an exchange">Sim</Chip>;
}

export function IconButton({ label, children, className = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...props}
      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-sunken hover:text-fg disabled:opacity-40 ${className}`}
    >
      {children}
    </button>
  );
}

/** Bottom sheet on phones, centered dialog on larger screens. Holds the prose we keep off the main view. */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", esc);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", esc); document.body.style.overflow = prev; };
  }, [open, onClose]);
  if (!open || typeof document === "undefined") return null;
  // Portal: ancestors with transforms (entry animations) would otherwise trap `fixed` positioning.
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-6" role="dialog" aria-modal="true">
      <button className="animate-fade absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={onClose} aria-label="Close" />
      <div className="animate-sheet relative max-h-[86vh] w-full overflow-y-auto rounded-t-3xl border border-line bg-surface px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3 shadow-2xl sm:max-w-lg sm:rounded-3xl sm:pt-5">
        <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-line-strong sm:hidden" aria-hidden />
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0 text-[15px] font-semibold leading-snug tracking-tight text-fg">{title}</div>
          <button onClick={onClose} className="-mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted hover:bg-sunken hover:text-fg" aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** Info icon that opens its text in a sheet. */
export function InfoTip({ title, children, className = "" }: { title: string; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={`About ${title}`} title={title} className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-subtle transition-colors hover:text-fg ${className}`}>
        <Icon name="info" className="h-3.5 w-3.5" />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={title}>
        <div className="space-y-3 text-sm leading-relaxed text-fg-2">{children}</div>
      </Sheet>
    </>
  );
}

/** Tiny uppercase label for widget tiles. */
export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`text-[11px] font-medium uppercase tracking-[0.08em] text-muted ${className}`}>{children}</div>;
}

/** Price vs Mayflower probability on one 0-100 track. */
export function OddsBar({ market, mine, compact = false }: { market: number; mine?: number; compact?: boolean }) {
  const m = Math.max(0, Math.min(1, market)) * 100;
  const y = mine == null ? null : Math.max(0, Math.min(1, mine)) * 100;
  const lo = y == null ? m : Math.min(m, y), hi = y == null ? m : Math.max(m, y);
  return (
    <div>
      <div className="relative h-1.5 rounded-full bg-line">
        {y != null && <div className={`absolute inset-y-0 rounded-full ${y >= m ? "bg-accent/35" : "bg-down/35"}`} style={{ left: `${lo}%`, width: `${hi - lo}%` }} />}
        <div className="absolute top-1/2 h-3 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted" style={{ left: `${m}%` }} title="Price" />
        {y != null && <div className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-accent" style={{ left: `${y}%` }} title="Mayflower" />}
      </div>
      {!compact && (
        <div className="num mt-1.5 flex justify-between text-[11px] text-muted">
          <span className="inline-flex items-center gap-1"><span className="h-2 w-0.5 rounded-full bg-muted" />{Math.round(m)}¢</span>
          {y != null && <span className="inline-flex items-center gap-1 text-accent"><span className="h-1.5 w-1.5 rounded-full bg-accent" />{Math.round(y)}%</span>}
        </div>
      )}
    </div>
  );
}

/** Segmented control. */
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="inline-flex rounded-full bg-sunken p-0.5" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={`flex h-8 items-center justify-center gap-1 rounded-full px-3 text-xs font-medium transition-colors ${value === o.value ? "bg-surface text-fg shadow-[0_1px_2px_rgba(0,0,0,0.12)] ring-1 ring-line-strong" : "text-muted hover:text-fg"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
