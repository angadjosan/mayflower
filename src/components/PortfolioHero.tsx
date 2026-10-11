"use client";
import { useMemo, useState } from "react";
import { AreaChart, type Point } from "./AreaChart";
import CountUp from "./reactbits/CountUp";
import DecryptedText from "./reactbits/DecryptedText";
import { Icon } from "./icons";
import type { DashState } from "./state";
import { Chip, Eyebrow, InfoTip, Ring, Segmented, pnlTone, signedPct, signedUsd, time, usd, usdCompact } from "./ui";

const RANGES = [
  { key: "1D", ms: 86_400_000 },
  { key: "1W", ms: 7 * 86_400_000 },
  { key: "1M", ms: 30 * 86_400_000 },
  { key: "All", ms: Infinity },
] as const;
type Range = (typeof RANGES)[number]["key"];

export const VENUE_COLOR: Record<string, string> = { gemini: "var(--accent)", hyperliquid: "#50e3c2", polymarket: "#4c6fff" };
export const VENUE_NAME: Record<string, string> = { gemini: "Gemini", hyperliquid: "Hyperliquid", polymarket: "Polymarket" };
const TOPIC_SHADES = ["var(--fg)", "var(--fg-2)", "var(--muted)", "var(--subtle)", "var(--line-strong)"];

function Tile({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-line bg-surface p-4 shadow-card ${className}`}>{children}</div>;
}

function StackBar({ items }: { items: { key: string; usd: number; color: string; label: string }[] }) {
  const total = items.reduce((a, b) => a + b.usd, 0);
  if (total <= 0) return <div className="h-2 rounded-full bg-sunken" />;
  return (
    <div className="flex h-2 gap-0.5 overflow-hidden rounded-full">
      {items.map((it) => (
        <div key={it.key} className="h-full transition-[flex-grow] duration-700" style={{ flexGrow: it.usd, background: it.color }} title={`${it.label} ${usd(it.usd)}`} />
      ))}
    </div>
  );
}

function Legend({ items }: { items: { key: string; usd: number; color: string; label: string }[] }) {
  const total = items.reduce((a, b) => a + b.usd, 0) || 1;
  return (
    <ul className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1">
      {items.map((it) => (
        <li key={it.key} className="flex items-center gap-1.5 text-xs text-fg-2">
          <span className="h-2 w-2 rounded-sm" style={{ background: it.color }} aria-hidden />
          <span className="max-w-[9rem] truncate">{it.label}</span>
          <span className="num text-muted">{Math.round((it.usd / total) * 100)}%</span>
        </li>
      ))}
    </ul>
  );
}

export function PortfolioHero({ s }: { s: DashState }) {
  const p = s.portfolio;
  const [range, setRange] = useState<Range>("All");
  const [hover, setHover] = useState<Point | null>(null);

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

  const open = s.positions.filter((x) => x.status === "open");
  const byVenue = new Map<string, number>();
  for (const x of open) {
    const v = x.venue ?? "gemini";
    byVenue.set(v, (byVenue.get(v) ?? 0) + (x.currentPrice ?? x.avgEntryPrice) * x.quantity);
  }
  const venueItems = [...byVenue.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ key: k, label: VENUE_NAME[k] ?? k, usd: v, color: VENUE_COLOR[k] ?? "var(--muted)" }));
  const topicItems = p.topicExposure.slice(0, 5).map((t, i) => ({ key: t.topic, label: t.topic, usd: t.usd, color: TOPIC_SHADES[i] }));

  const riskPct = p.riskBudgetUsd > 0 ? Math.min(1, p.atRiskUsd / p.riskBudgetUsd) : 0;
  const g = s.balances?.gemini;
  const w = s.balances?.testWallet;
  const funds = [
    { key: "gemini", label: "Gemini", usd: g?.availableUsd ?? 0, sim: g?.mode === "simulated" },
    { key: "hyperliquid", label: "Hyperliquid", usd: w?.usdc ?? 0, sim: false },
  ];
  const fundsMax = Math.max(1, ...funds.map((f) => f.usd));

  return (
    <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-8">
      {/* Value + chart */}
      <div className="min-w-0">
        <div className="num flex items-baseline text-[44px] font-semibold leading-none tracking-[-0.035em] text-fg sm:text-[60px]">
          {hover ? (
            whole
          ) : (
            <span>
              $<CountUp to={Math.floor(shown)} from={Math.floor(shown * 0.94)} separator="," duration={1.1} />
            </span>
          )}
          <span className="text-[0.5em] text-muted">.{frac}</span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Chip tone={pnlTone(delta)}>
            <Icon name="arrowUpRight" className={`h-3 w-3 ${delta < 0 ? "rotate-90" : ""}`} />
            {hover ? signedUsd(delta) : (
              <span>
                {delta > 0 ? "+" : delta < 0 ? "−" : ""}$<CountUp to={Math.abs(delta)} from={0} decimals={2} separator="," duration={1.1} />
              </span>
            )}{" "}
            · {signedPct(deltaPct)}
          </Chip>
          <span className="text-xs text-subtle">{hover ? time(hover.at) : range === "All" ? "All time" : range}</span>
        </div>

        <div className="-mx-1 mt-5">
          <AreaChart points={series} height={180} onHover={setHover} positive={delta >= 0} />
        </div>
        <div className="mt-3 flex justify-end">
          <Segmented<Range> label="Chart range" value={range} onChange={setRange} options={RANGES.map((r) => ({ value: r.key, label: r.key }))} />
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Unrealized" value={signedUsd(p.unrealizedPnlUsd)} tone={p.unrealizedPnlUsd} />
          <Stat label="Realized" value={signedUsd(p.realizedPnlUsd)} tone={p.realizedPnlUsd} />
          <Stat label="Invested" value={usd(p.investedUsd, 0)} />
          <Stat label="Sharpe" value={p.sharpe == null ? "—" : p.sharpe.toFixed(2)} />
        </div>
      </div>

      {/* Widgets */}
      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-1 lg:content-start">
        <Tile className="flex flex-col items-center justify-center gap-2 text-center lg:flex-row lg:justify-start lg:gap-4 lg:text-left">
          <Ring value={riskPct} size={64} stroke={6} color={riskPct > 0.85 ? "var(--down)" : "var(--accent)"} label={`${Math.round(riskPct * 100)}% of risk budget used`}>
            <span className="num text-sm font-semibold text-fg">{Math.round(riskPct * 100)}%</span>
          </Ring>
          <div className="min-w-0">
            <Eyebrow>Risk</Eyebrow>
            <div className="num mt-1 text-sm font-medium text-fg">{usdCompact(p.atRiskUsd)}<span className="text-muted"> / {usdCompact(p.riskBudgetUsd)}</span></div>
          </div>
        </Tile>

        <Tile>
          <div className="flex items-center justify-between">
            <Eyebrow className="flex items-center gap-1.5"><Icon name="wallet" className="h-3.5 w-3.5" />Funds</Eyebrow>
            <InfoTip title="Test funds">
              <p>Buying power on test venues: the Gemini sandbox account and your Hyperliquid test wallet (testUSDC). None of it is real money.</p>
              {w && (
                <p className="font-mono text-xs text-muted break-all">
                  <DecryptedText text={w.address} animateOn="view" sequential speed={18} revealDirection="start" encryptedClassName="text-subtle" />
                </p>
              )}
            </InfoTip>
          </div>
          <ul className="mt-2 space-y-2.5">
            {funds.map((f) => (
              <li key={f.key}>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="flex items-center gap-1.5 text-fg-2">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: VENUE_COLOR[f.key] }} aria-hidden />
                    {f.label}
                  </span>
                  <span className="num font-medium text-fg">{usdCompact(f.usd)}</span>
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-sunken">
                  <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${(f.usd / fundsMax) * 100}%`, background: VENUE_COLOR[f.key] }} />
                </div>
              </li>
            ))}
          </ul>
          {w && (
            <div className="mt-2.5 truncate font-mono text-[10.5px] text-subtle" title={w.address}>
              <DecryptedText text={`${w.address.slice(0, 6)}…${w.address.slice(-4)}`} animateOn="view" sequential speed={40} encryptedClassName="opacity-60" />
            </div>
          )}
        </Tile>

        <Tile className="col-span-2 lg:col-span-1">
          <Eyebrow className="flex items-center gap-1.5"><Icon name="layers" className="h-3.5 w-3.5" />Allocation</Eyebrow>
          {venueItems.length === 0 ? (
            <div className="mt-3 h-2 rounded-full bg-sunken" />
          ) : (
            <div className="mt-3 space-y-4">
              <div>
                <StackBar items={venueItems} />
                <Legend items={venueItems} />
              </div>
              {topicItems.length > 0 && (
                <div>
                  <StackBar items={topicItems} />
                  <Legend items={topicItems} />
                </div>
              )}
            </div>
          )}
        </Tile>
      </div>
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: number }) {
  return (
    <div className="rounded-xl bg-sunken px-3 py-2.5">
      <div className="text-[11px] text-muted">{label}</div>
      <div className={`num mt-0.5 text-sm font-semibold ${tone == null || tone === 0 ? "text-fg" : tone > 0 ? "text-up" : "text-down"}`}>{value}</div>
    </div>
  );
}
