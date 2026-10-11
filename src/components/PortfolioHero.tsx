"use client";
import { useMemo, useState } from "react";
import { AreaChart, type Point } from "./AreaChart";
import type { DashState } from "./state";
import { signedPct, signedUsd, time, usd, usdCompact } from "./ui";

const RANGES = [
  { key: "1D", ms: 86_400_000 },
  { key: "1W", ms: 7 * 86_400_000 },
  { key: "1M", ms: 30 * 86_400_000 },
  { key: "All", ms: Infinity },
] as const;

const VENUE_COLOR: Record<string, string> = { gemini: "var(--accent)", hyperliquid: "#50e3c2", polymarket: "#4c6fff" };
const VENUE_NAME: Record<string, string> = { gemini: "Gemini", hyperliquid: "Hyperliquid", polymarket: "Polymarket" };
// Topic segments: one hue, stepped lightness, so the bar reads as a single quantity split up.
const TOPIC_SHADES = ["var(--fg)", "var(--fg-2)", "var(--muted)", "var(--subtle)", "var(--line-strong)"];

function Split({ items, total }: { items: { key: string; label: string; usd: number; color: string }[]; total: number }) {
  if (total <= 0) return <div className="h-1.5 rounded-full bg-sunken" />;
  return (
    <>
      <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-full">
        {items.map((it) => (
          <div key={it.key} className="h-full transition-[flex-grow] duration-700" style={{ flexGrow: it.usd, background: it.color }} title={`${it.label} ${usd(it.usd)}`} />
        ))}
      </div>
      <ul className="mt-3 space-y-2">
        {items.map((it) => (
          <li key={it.key} className="flex items-center gap-2 text-[13px]">
            <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: it.color }} aria-hidden />
            <span className="min-w-0 flex-1 truncate text-fg-2">{it.label}</span>
            <span className="num text-fg">{usd(it.usd, 0)}</span>
            <span className="num w-10 text-right text-xs text-muted">{Math.round((it.usd / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </>
  );
}

function Panel({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="py-5 first:pt-0 last:pb-0">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-medium uppercase tracking-[0.08em] text-muted">{title}</h3>
        {aside}
      </div>
      {children}
    </div>
  );
}

export function PortfolioHero({ s }: { s: DashState }) {
  const p = s.portfolio;
  const [range, setRange] = useState<(typeof RANGES)[number]["key"]>("All");
  const [hover, setHover] = useState<Point | null>(null);

  // History plus "now", so the line always ends at the live value.
  const series = useMemo(() => {
    const all: Point[] = [...p.history, { at: new Date().toISOString(), valueUsd: p.valueUsd }];
    const r = RANGES.find((x) => x.key === range)!;
    const cut = Date.now() - r.ms;
    const inRange = all.filter((x) => new Date(x.at).getTime() >= cut);
    return inRange.length >= 2 ? inRange : all;
  }, [p.history, p.valueUsd, range]);

  const pnl = p.unrealizedPnlUsd + p.realizedPnlUsd;
  const base = p.riskBudgetUsd || p.valueUsd - pnl;
  const shown = hover?.valueUsd ?? p.valueUsd;
  const rangeStart = series[0]?.valueUsd ?? p.valueUsd;
  const delta = hover ? hover.valueUsd - rangeStart : range === "All" ? pnl : p.valueUsd - rangeStart;
  const deltaBase = range === "All" && !hover ? base : rangeStart;
  const deltaPct = deltaBase > 0 ? delta / deltaBase : 0;
  const [whole, frac] = usd(shown).split(".");
  const hasHistory = p.history.length >= 1;

  // Allocation by venue (market value of open positions).
  const open = s.positions.filter((x) => x.status === "open");
  const byVenue = new Map<string, number>();
  for (const x of open) {
    const v = x.venue ?? "gemini";
    byVenue.set(v, (byVenue.get(v) ?? 0) + (x.currentPrice ?? x.avgEntryPrice) * x.quantity);
  }
  const venueItems = [...byVenue.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => ({ key: k, label: VENUE_NAME[k] ?? k, usd: v, color: VENUE_COLOR[k] ?? "var(--muted)" }));
  const venueTotal = venueItems.reduce((a, b) => a + b.usd, 0);
  const topicItems = p.topicExposure.slice(0, 5).map((t, i) => ({ key: t.topic, label: t.topic, usd: t.usd, color: TOPIC_SHADES[i] }));
  const topicTotal = topicItems.reduce((a, b) => a + b.usd, 0);

  const riskPct = p.riskBudgetUsd > 0 ? Math.min(1, p.atRiskUsd / p.riskBudgetUsd) : 0;
  const g = s.balances?.gemini;
  const w = s.balances?.testWallet;

  return (
    <section className="grid gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_320px]">
      {/* Value + chart */}
      <div className="min-w-0">
        <div className="text-[13px] text-muted">Portfolio value</div>
        <div className="num mt-2 flex items-baseline text-[44px] font-semibold leading-none tracking-[-0.03em] text-fg sm:text-[56px]">
          {whole}
          <span className="text-[0.55em] text-muted">.{frac}</span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className={`num font-medium ${delta > 0 ? "text-up" : delta < 0 ? "text-down" : "text-muted"}`}>
            {signedUsd(delta)} ({signedPct(deltaPct)})
          </span>
          <span className="text-muted">
            {hover ? time(hover.at) : range === "All" ? "all time" : `past ${range === "1D" ? "day" : range === "1W" ? "week" : "month"}`}
          </span>
        </div>

        <div className="mt-6 -mx-1">
          <AreaChart points={series} height={200} onHover={setHover} positive={delta >= 0} />
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-xs text-subtle">
            {hasHistory ? `${p.history.length} snapshot${p.history.length === 1 ? "" : "s"} · risk budget + P&L` : "Chart fills in as Mayflower records snapshots."}
          </p>
          <div className="flex gap-0.5" role="tablist" aria-label="Chart range">
            {RANGES.map((r) => (
              <button
                key={r.key}
                role="tab"
                aria-selected={range === r.key}
                onClick={() => setRange(r.key)}
                className={`h-7 rounded-full px-2.5 text-xs font-medium transition-colors ${range === r.key ? "bg-sunken text-fg" : "text-muted hover:text-fg"}`}
              >
                {r.key}
              </button>
            ))}
          </div>
        </div>

        <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-line pt-5 sm:grid-cols-4">
          <Kpi label="Unrealized" value={signedUsd(p.unrealizedPnlUsd)} tone={p.unrealizedPnlUsd} />
          <Kpi label="Realized" value={signedUsd(p.realizedPnlUsd)} tone={p.realizedPnlUsd} />
          <Kpi label="Invested" value={usd(p.investedUsd)} />
          <Kpi label="Sharpe" value={p.sharpe == null ? "—" : p.sharpe.toFixed(2)} hint={p.sharpe == null ? "needs 20 snapshots" : undefined} />
        </dl>
      </div>

      {/* Side panels */}
      <aside className="divide-y divide-line lg:border-l lg:border-line lg:pl-10">
        <Panel title="Buying power" aside={<span className="text-[11px] text-subtle">test funds</span>}>
          <div className="space-y-2.5">
            <Row
              dot={VENUE_COLOR.gemini}
              label="Gemini sandbox"
              value={g ? usd(g.availableUsd) : "—"}
              hint={g?.mode === "simulated" ? "simulated" : "USD"}
            />
            <Row
              dot={VENUE_COLOR.hyperliquid}
              label="Hyperliquid test wallet"
              value={w ? usd(w.usdc) : "—"}
              hint={w ? <span className="font-mono" title={w.address}>{w.address.slice(0, 6)}…{w.address.slice(-4)}</span> : "not created"}
            />
          </div>
        </Panel>

        <Panel title="Risk used" aside={<span className="num text-xs text-fg-2">{Math.round(riskPct * 100)}%</span>}>
          <div className="relative h-1.5 overflow-hidden rounded-full bg-sunken">
            <div
              className={`h-full rounded-full transition-[width] duration-700 ${riskPct > 0.85 ? "bg-down" : "bg-fg"}`}
              style={{ width: `${riskPct * 100}%` }}
            />
          </div>
          <div className="num mt-2 flex justify-between text-[13px]">
            <span className="text-fg">{usd(p.atRiskUsd, 0)} at risk</span>
            <span className="text-muted">of {usd(p.riskBudgetUsd, 0)} budget</span>
          </div>
          <div className="mt-1 text-xs text-subtle">{usdCompact(p.availableUsd)} left to deploy</div>
        </Panel>

        <Panel title="By venue">
          {venueItems.length ? <Split items={venueItems} total={venueTotal} /> : <p className="text-[13px] text-subtle">No open positions.</p>}
        </Panel>

        {topicItems.length > 0 && (
          <Panel title="By topic">
            <Split items={topicItems} total={topicTotal} />
          </Panel>
        )}
      </aside>
    </section>
  );
}

function Kpi({ label, value, tone, hint }: { label: string; value: string; tone?: number; hint?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`num mt-1 text-[15px] font-medium ${tone == null ? "text-fg" : tone > 0 ? "text-up" : tone < 0 ? "text-down" : "text-fg"}`}>{value}</dd>
      {hint && <dd className="mt-0.5 text-[11px] text-subtle">{hint}</dd>}
    </div>
  );
}

function Row({ dot, label, value, hint }: { dot: string; label: string; value: string; hint?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: dot }} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] text-fg-2">{label}</div>
        {hint && <div className="truncate text-[11px] text-subtle">{hint}</div>}
      </div>
      <div className="num text-sm font-medium text-fg">{value}</div>
    </div>
  );
}
