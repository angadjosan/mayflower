"use client";
import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Empty, Stat, cents, pct, usd } from "./ui";

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

function Bars({ title, items, limit }: { title: string; items: Bucket[]; limit: number }) {
  if (!items.length) return null;
  return (
    <div>
      <div className="mb-1.5 text-xs font-medium text-muted">{title} <span className="font-normal text-subtle">(flag above {pct(limit)})</span></div>
      <div className="space-y-1.5">
        {items.slice(0, 5).map((b) => {
          const over = b.pct > limit;
          return (
            <div key={b.key}>
              <div className="flex justify-between gap-2 text-xs">
                <span className="truncate text-fg-2">{b.label}</span>
                <span className={`tabular-nums ${over ? "font-medium text-warn" : "text-muted"}`}>{usd(b.usd)} · {pct(b.pct)}</span>
              </div>
              <div className="relative mt-0.5 h-2 rounded-full bg-sunken">
                <div className={`h-2 rounded-full transition-[width] duration-700 ${over ? "bg-warn" : "bg-fg"}`} style={{ width: `${Math.min(100, b.pct * 100)}%` }} />
                <div className="absolute top-[-2px] h-2.5 w-px bg-line-strong" style={{ left: `${limit * 100}%` }} aria-hidden />
              </div>
            </div>
          );
        })}
      </div>
    </div>
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

  if (error) return <Card title="Risk"><Empty>Couldn&apos;t load risk data ({error}).</Empty></Card>;
  if (!data) return <Card title="Risk"><div className="text-sm text-subtle">Loading…</div></Card>;
  const { concentration: c, calibration: cal, hedges } = data;

  return (
    <Card title="Concentration, calibration &amp; exits" action={<Button variant="ghost" size="sm" onClick={() => void load()}>Refresh</Button>}>
      <div className="space-y-6">
        <section>
          <div className="mb-2 flex items-center gap-2">
            <h3 className="text-sm font-semibold text-fg">Concentration</h3>
            {c.flagged ? <Badge tone="warn">Concentrated</Badge> : c.openPositions > 0 ? <Badge tone="good">Spread out</Badge> : null}
          </div>
          <p className="mb-3 text-sm text-fg-2">{c.explanation}</p>
          {c.openPositions > 0 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Bars title="By topic" items={c.topics} limit={0.5} />
              <Bars title="By event" items={c.events} limit={0.35} />
            </div>
          )}
        </section>

        <section>
          <h3 className="mb-2 text-sm font-semibold text-fg">Forecast calibration</h3>
          {cal.count === 0 ? (
            <p className="text-sm text-muted">N/A until markets settle. Once markets I forecast resolve, I&apos;ll compare my accuracy with the market&apos;s.</p>
          ) : (
            <>
              <div className="mb-2 grid grid-cols-3 gap-3">
                <Stat label="My Brier (lower is better)" value={cal.avgBrier?.toFixed(3) ?? "N/A"} />
                <Stat label="Market Brier" value={cal.marketAvgBrier?.toFixed(3) ?? "N/A"} />
                <Stat label="Hit rate" value={pct(cal.hitRate)} />
              </div>
              <p className="text-sm text-fg-2">{cal.explanation}</p>
              {cal.buckets.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted">
                  {cal.buckets.map((b) => (
                    <span key={b.range} className="rounded-full bg-sunken px-2 py-0.5">
                      Said {b.range}: happened {pct(b.observedYesRate)} ({b.count})
                    </span>
                  ))}
                </div>
              )}
            </>
          )}
        </section>

        <section>
          <h3 className="mb-2 text-sm font-semibold text-fg">Exit watch & hedge ideas</h3>
          {hedges.length === 0 ? (
            <Empty>No open positions to protect.</Empty>
          ) : (
            <div className="space-y-3">
              {hedges.map((h) => (
                <div key={h.positionId} className="rounded-2xl bg-sunken p-3.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{h.marketTitle}</div>
                      <div className="text-xs text-muted">{h.quantity} {h.side} · {usd(h.costBasisUsd)} at risk</div>
                    </div>
                    {(h.stopPrice != null || h.takeProfitPrice != null) && (
                      <div className="text-xs text-muted">
                        Alert ≤ {cents(h.stopPrice)} · ≥ {cents(h.takeProfitPrice)} <span className="text-subtle">(alerts, not guaranteed stops)</span>
                      </div>
                    )}
                  </div>
                  {h.ideas.length === 0 ? (
                    <p className="mt-2 text-xs text-muted">{h.note}</p>
                  ) : (
                    <ul className="mt-2 space-y-2">
                      {h.ideas.map((i) => {
                        const k = `${h.positionId}:${i.marketId}:${i.side}`;
                        const done = created[k];
                        return (
                          <li key={k} className="rounded-xl border border-line bg-surface p-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge tone="warn">{i.label}</Badge>
                              <span className="text-sm font-medium">Buy {i.quantity} {i.side} · {i.marketTitle}</span>
                            </div>
                            <div className="mt-1 text-xs text-fg-2">
                              Cost {usd(i.costUsd)} · worst case {usd(i.worstCaseBeforeUsd)} → {usd(i.worstCaseAfterUsd)} (saves {usd(i.lossReducedUsd)})
                              {i.costIfPositionWinsUsd > 0 ? ` · costs up to ${usd(i.costIfPositionWinsUsd)} if your bet wins` : ""}
                            </div>
                            <p className="mt-1 text-xs text-muted">{i.explanation}</p>
                            <div className="mt-2">
                              {done?.url ? (
                                <a href={done.url} className="text-sm font-medium text-accent underline underline-offset-2">Review &amp; approve hedge →</a>
                              ) : (
                                <Button variant="outline" disabled={busy === k} onClick={() => void proposeHedge(h.positionId, i)}>
                                  {busy === k ? "Creating…" : "Propose hedge"}
                                </Button>
                              )}
                              {done?.error && <p className="mt-1 text-xs text-down">{done.error}</p>}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </Card>
  );
}
