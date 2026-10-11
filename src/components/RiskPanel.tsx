"use client";
import { useCallback, useEffect, useState } from "react";
import { Icon } from "./icons";
import { Chip, Eyebrow, IconButton, InfoTip, Ring, cents, pct, usd, usdCompact } from "./ui";

type Bucket = { key: string; label: string; usd: number; pct: number; positionIds: string[] };
type Concentration = {
  atRiskUsd: number; openPositions: number; topics: Bucket[]; events: Bucket[];
  flags: { kind: "topic" | "event"; label: string; pct: number; limit: number }[]; flagged: boolean; explanation: string;
};
type Calibration = {
  count: number; inferredCount: number; avgBrier: number | null; marketAvgBrier: number | null; hitRate: number | null;
  buckets: { range: string; count: number; avgForecast: number; observedYesRate: number }[]; explanation: string;
};
type Idea = {
  marketId: string; marketTitle: string; eventTitle: string; side: "YES" | "NO"; quantity: number; price: number; costUsd: number;
  relation: string; worstCaseBeforeUsd: number; worstCaseAfterUsd: number; lossReducedUsd: number; costIfPositionWinsUsd: number;
  label: string; explanation: string;
};
type PositionHedges = {
  positionId: string; marketTitle: string; eventTitle: string; side: "YES" | "NO"; quantity: number; costBasisUsd: number;
  stopPrice?: number; takeProfitPrice?: number; watchConditions?: string; ideas: Idea[]; note?: string;
};
type RiskData = { concentration: Concentration; calibration: Calibration; hedges: PositionHedges[] };

function Bars({ items, limit, icon }: { items: Bucket[]; limit: number; icon: "layers" | "target" }) {
  if (!items.length) return null;
  return (
    <div className="space-y-2.5">
      {items.slice(0, 4).map((b) => {
        const over = b.pct > limit;
        return (
          <div key={b.key}>
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="flex min-w-0 items-center gap-1.5 text-fg-2"><Icon name={icon} className="h-3 w-3 shrink-0 text-subtle" /><span className="truncate">{b.label}</span></span>
              <span className={`num shrink-0 ${over ? "text-warn" : "text-muted"}`}>{pct(b.pct)}</span>
            </div>
            <div className="relative mt-1 h-1.5 rounded-full bg-sunken">
              <div className={`h-full rounded-full transition-[width] duration-700 ${over ? "bg-warn" : "bg-fg"}`} style={{ width: `${Math.min(100, b.pct * 100)}%` }} />
              <div className="absolute -top-0.5 h-2.5 w-px bg-muted" style={{ left: `${limit * 100}%` }} title={`Limit ${pct(limit)}`} aria-hidden />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Tile({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-line bg-surface p-4 shadow-card ${className}`}>{children}</div>;
}

function Gauge({ label, value, display, color, sub }: { label: string; value: number; display: string; color: string; sub?: string }) {
  return (
    <Tile className="flex flex-col items-center gap-2 text-center">
      <Ring value={value} size={60} stroke={5.5} color={color} label={`${label} ${display}`}>
        <span className="num text-[13px] font-semibold text-fg">{display}</span>
      </Ring>
      <div>
        <Eyebrow>{label}</Eyebrow>
        {sub && <div className="num mt-0.5 text-[11px] text-subtle">{sub}</div>}
      </div>
    </Tile>
  );
}

export default function RiskPanel() {
  const [data, setData] = useState<RiskData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [created, setCreated] = useState<Record<string, { url?: string; error?: string }>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/risk", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function proposeHedge(positionId: string, idea: Idea) {
    const k = `${positionId}:${idea.marketId}:${idea.side}`;
    setBusy(k);
    try {
      const res = await fetch("/api/risk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "hedge", positionId, marketId: idea.marketId, side: idea.side }),
      });
      const j = await res.json();
      setCreated((c) => ({ ...c, [k]: res.ok ? { url: j.approvalUrl } : { error: j.error ?? "Could not create the hedge proposal." } }));
    } catch {
      setCreated((c) => ({ ...c, [k]: { error: "Network error." } }));
    } finally {
      setBusy(null);
    }
  }

  if (error) return <Tile className="text-sm text-muted">Risk unavailable ({error})</Tile>;
  if (!data) {
    return (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-[120px] animate-pulse rounded-2xl bg-sunken" />)}
      </div>
    );
  }
  const { concentration: c, calibration: cal, hedges } = data;
  const top = c.topics[0];
  const brierEdge = cal.avgBrier != null && cal.marketAvgBrier != null ? cal.marketAvgBrier - cal.avgBrier : null;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        <Gauge
          label="Top topic"
          value={top?.pct ?? 0}
          display={top ? pct(top.pct) : "—"}
          color={c.flagged ? "var(--warn)" : "var(--accent)"}
          sub={top?.label}
        />
        <Gauge label="Hit rate" value={cal.hitRate ?? 0} display={cal.hitRate == null ? "—" : pct(cal.hitRate)} color="var(--up)" sub={cal.count ? `${cal.count} settled` : "none settled"} />
        <Tile className="flex flex-col justify-between">
          <Eyebrow>Brier</Eyebrow>
          <div className="mt-2 space-y-2">
            <BrierBar label="Mayflower" v={cal.avgBrier} color="var(--accent)" />
            <BrierBar label="Market" v={cal.marketAvgBrier} color="var(--muted)" />
          </div>
          <div className="num mt-2 text-[11px] text-subtle">{brierEdge == null ? "lower is better" : `${brierEdge >= 0 ? "beats" : "trails"} market`}</div>
        </Tile>
        <Tile className="flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <Eyebrow>At risk</Eyebrow>
            <IconButton label="Refresh" onClick={() => void load()} className="-mr-2 -mt-2 h-7 w-7"><Icon name="refresh" className="h-3.5 w-3.5" /></IconButton>
          </div>
          <div className="num text-2xl font-semibold tracking-tight text-fg">{usdCompact(c.atRiskUsd)}</div>
          <div className="text-[11px] text-subtle">{c.openPositions} open</div>
        </Tile>
      </div>

      {c.openPositions > 0 && (
        <Tile>
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Eyebrow>Concentration</Eyebrow>
              {c.flagged ? <Chip tone="warn" className="h-5 text-[11px]">High</Chip> : <Chip tone="up" className="h-5 text-[11px]">OK</Chip>}
            </div>
            <InfoTip title="Concentration"><p>{c.explanation}</p></InfoTip>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <Bars items={c.topics} limit={0.5} icon="layers" />
            <Bars items={c.events} limit={0.35} icon="target" />
          </div>
        </Tile>
      )}

      {hedges.length > 0 && (
        <Tile>
          <div className="mb-3 flex items-center justify-between">
            <Eyebrow className="flex items-center gap-1.5"><Icon name="shield" className="h-3.5 w-3.5" />Exits &amp; hedges</Eyebrow>
            <InfoTip title="Exit alerts & hedges">
              <p>Alert levels trigger a sell suggestion; they are not guaranteed stop orders. Hedges are new trades that reduce your worst case. Every one still needs your approval.</p>
              {cal.explanation && <p>{cal.explanation}</p>}
            </InfoTip>
          </div>
          <ul className="divide-y divide-line">
            {hedges.map((h) => (
              <li key={h.positionId} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{h.marketTitle}</span>
                  {h.stopPrice != null && <Chip className="h-5 px-1.5 text-[11px]" title="Exit alert">≤ {cents(h.stopPrice)}</Chip>}
                  {h.takeProfitPrice != null && <Chip className="h-5 px-1.5 text-[11px]" title="Take-profit alert">≥ {cents(h.takeProfitPrice)}</Chip>}
                </div>
                {h.ideas.length > 0 && (
                  <ul className="mt-2 space-y-1.5">
                    {h.ideas.map((i) => {
                      const k = `${h.positionId}:${i.marketId}:${i.side}`;
                      const done = created[k];
                      return (
                        <li key={k} className="flex flex-wrap items-center gap-1.5 rounded-xl bg-sunken px-3 py-2">
                          <span className="min-w-0 flex-1 truncate text-xs text-fg-2" title={`${i.label}: ${i.explanation}`}>{i.marketTitle}</span>
                          <Chip className="h-5 px-1.5 text-[11px]">{i.side} {usd(i.costUsd, 0)}</Chip>
                          <Chip tone="up" className="h-5 px-1.5 text-[11px]" title="Worst-case loss reduced by">−{usd(i.lossReducedUsd, 0)} risk</Chip>
                          {done?.url ? (
                            <a href={done.url} className="inline-flex h-7 items-center gap-1 rounded-full bg-ink px-3 text-[11px] font-medium text-ink-fg">Approve <Icon name="arrowRight" className="h-3 w-3" /></a>
                          ) : (
                            <button
                              disabled={busy === k}
                              onClick={() => void proposeHedge(h.positionId, i)}
                              className="inline-flex h-7 items-center gap-1 rounded-full border border-line-strong bg-surface px-3 text-[11px] font-medium text-fg hover:bg-raised disabled:opacity-50"
                            >
                              <Icon name="shield" className="h-3 w-3" />{busy === k ? "…" : "Hedge"}
                            </button>
                          )}
                          {done?.error && <span className="w-full text-[11px] text-down">{done.error}</span>}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </Tile>
      )}
    </div>
  );
}

function BrierBar({ label, v, color }: { label: string; v: number | null; color: string }) {
  return (
    <div>
      <div className="num flex justify-between text-[11px] text-muted"><span>{label}</span><span className="text-fg-2">{v == null ? "—" : v.toFixed(2)}</span></div>
      <div className="mt-1 h-1 rounded-full bg-sunken">
        <div className="h-full rounded-full" style={{ width: `${v == null ? 0 : Math.min(100, (v / 0.5) * 100)}%`, background: color }} />
      </div>
    </div>
  );
}
