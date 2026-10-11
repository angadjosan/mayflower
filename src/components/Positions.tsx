"use client";
import { useState } from "react";
import type { MonitorEvent } from "@/lib/types";
import type { PositionView } from "./state";
import { Badge, Card, CitationLink, Empty, cents, date, pct, pnlClass, signedUsd, time, usd } from "./ui";

export function Positions({ positions, events }: { positions: PositionView[]; events: MonitorEvent[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <Card title="Your bets" action={positions.length ? <span className="text-xs text-stone-400">Tap for details</span> : undefined}>
      {positions.length === 0 ? (
        <Empty><div className="mb-1 text-2xl" aria-hidden>🎯</div>No bets yet. Trades you approve show up here.</Empty>
      ) : (
        <ul className="-mx-2 space-y-1">
          {positions.map((p) => {
            const cur = p.currentPrice;
            const unreal = cur == null || p.status !== "open" ? 0 : (cur - p.avgEntryPrice) * p.quantity;
            const isOpen = openId === p.id;
            const evs = events.filter((e) => e.positionId === p.id);
            const value = cur == null ? null : cur * p.quantity;
            return (
              <li key={p.id} className={`rounded-2xl transition-colors ${isOpen ? "bg-stone-50" : "hover:bg-stone-50"}`}>
                <button
                  type="button"
                  onClick={() => setOpenId(isOpen ? null : p.id)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center gap-3 px-3 py-3 text-left transition-transform active:scale-[0.99]"
                >
                  <span
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xs font-extrabold ${
                      p.side === "YES" ? "bg-money-100 text-money-700" : "bg-rose-100 text-rose-600"
                    }`}
                  >
                    {p.side}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold">{p.market.title}</span>
                    <span className="block truncate text-xs text-stone-500">
                      {p.quantity} × {cents(p.avgEntryPrice)} → {cents(cur)} · {p.status === "open" ? `ends ${date(p.market.expiresAt)}` : p.status}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-[15px] font-bold tabular-nums">{value == null ? usd(p.costBasisUsd) : usd(value)}</span>
                    <span
                      className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ${
                        unreal > 0 ? "bg-money-100 text-money-700" : unreal < 0 ? "bg-rose-100 text-rose-600" : "bg-stone-100 text-stone-500"
                      }`}
                    >
                      {cur == null ? "—" : signedUsd(unreal)}
                    </span>
                    {p.realizedPnlUsd !== 0 && <span className={`block text-[11px] ${pnlClass(p.realizedPnlUsd)}`}>realized {signedUsd(p.realizedPnlUsd)}</span>}
                  </span>
                </button>
                {isOpen && (
                  <div className="animate-rise px-3 pb-4 pt-1">
                    <div className="mb-3 flex flex-wrap gap-1.5">
                      <Badge tone={p.status === "open" ? "good" : "neutral"}>{p.status}</Badge>
                      <Badge>Invested {usd(p.costBasisUsd)}</Badge>
                      {p.market.eventTitle && <Badge>{p.market.eventTitle}</Badge>}
                    </div>
                    <div className="grid gap-4 text-sm sm:grid-cols-2">
                      <Block label="Original thesis">{p.thesis || "—"}</Block>
                      <Block label="Latest assessment">{p.latestAssessment || "No reassessment yet."}</Block>
                      <Block label="Forecast vs market">
                        Mayflower {pct(p.estimatedProbability)} vs market {pct(cur ?? p.avgEntryPrice)} for {p.side}
                      </Block>
                      <Block label="Why this size">{p.sizingExplanation || "—"}</Block>
                      <Block label="Watch / exit conditions">{p.watchConditions || "—"}</Block>
                      <Block label="Sources">
                        {p.citations?.length ? (
                          <ul className="space-y-0.5">
                            {p.citations.map((c, i) => <li key={i}><CitationLink c={c} /></li>)}
                          </ul>
                        ) : "—"}
                      </Block>
                    </div>
                    {evs.length > 0 && (
                      <div className="mt-4">
                        <div className="text-xs font-semibold text-stone-500">Monitor history</div>
                        <ul className="mt-1 space-y-1.5">
                          {evs.map((e) => (
                            <li key={e.id} className="text-sm">
                              <span className="text-xs text-stone-400">{time(e.createdAt)}</span>{" "}
                              <Badge tone={e.recommendation === "hold" ? "neutral" : "warn"}>{e.recommendation}</Badge>{" "}
                              <span className="text-stone-700">{e.trigger}: {e.explanation}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <p className="mt-3 text-xs text-stone-400">Alerts are recommendations, not guaranteed stop orders. Any sell still needs your approval.</p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-semibold text-stone-500">{label}</div>
      <div className="mt-0.5 text-stone-700">{children}</div>
    </div>
  );
}
