"use client";
import { Fragment, useState } from "react";
import type { MonitorEvent } from "@/lib/types";
import type { PositionView } from "./state";
import { Badge, Card, CitationLink, Empty, cents, date, pct, pnlClass, signedUsd, time, usd } from "./ui";

export function Positions({ positions, events }: { positions: PositionView[]; events: MonitorEvent[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <Card title="Positions">
      {positions.length === 0 ? (
        <Empty>No positions yet. Approved trades will show up here.</Empty>
      ) : (
        <div className="-mx-5 overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-stone-100 text-left text-xs text-stone-500">
                {["Market", "Side", "Qty", "Entry", "Current", "Invested", "Unrealized", "Expires", "Status"].map((h) => (
                  <th key={h} className="px-3 py-2 font-medium first:pl-5 last:pr-5">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {positions.map((p) => {
                const cur = p.currentPrice;
                const unreal = cur == null || p.status !== "open" ? 0 : (cur - p.avgEntryPrice) * p.quantity;
                const isOpen = openId === p.id;
                const evs = events.filter((e) => e.positionId === p.id);
                return (
                  <Fragment key={p.id}>
                    <tr
                      onClick={() => setOpenId(isOpen ? null : p.id)}
                      className={`cursor-pointer border-b border-stone-100 hover:bg-stone-50 ${isOpen ? "bg-stone-50" : ""}`}
                    >
                      <td className="max-w-[260px] px-3 py-2.5 pl-5">
                        <div className="truncate font-medium">{p.market.title}</div>
                        <div className="truncate text-xs text-stone-400">{p.market.eventTitle}</div>
                      </td>
                      <td className={`px-3 font-medium ${p.side === "YES" ? "text-emerald-700" : "text-rose-700"}`}>{p.side}</td>
                      <td className="px-3 tabular-nums">{p.quantity}</td>
                      <td className="px-3 tabular-nums">{cents(p.avgEntryPrice)}</td>
                      <td className="px-3 tabular-nums">{cents(cur)}</td>
                      <td className="px-3 tabular-nums">{usd(p.costBasisUsd)}</td>
                      <td className={`px-3 tabular-nums ${pnlClass(unreal)}`}>
                        {cur == null ? "—" : signedUsd(unreal)}
                        {p.realizedPnlUsd !== 0 && <div className={`text-xs ${pnlClass(p.realizedPnlUsd)}`}>realized {signedUsd(p.realizedPnlUsd)}</div>}
                      </td>
                      <td className="px-3 text-stone-500">{date(p.market.expiresAt)}</td>
                      <td className="px-3 pr-5">
                        <Badge tone={p.status === "open" ? "good" : "neutral"}>{p.status}</Badge>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b border-stone-100 bg-stone-50">
                        <td colSpan={9} className="px-5 pb-4 pt-1">
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
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
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
