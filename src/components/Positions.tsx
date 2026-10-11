"use client";
import { Fragment, useState } from "react";
import type { MonitorEvent } from "@/lib/types";
import PositionActions from "./PositionActions";
import type { PositionView } from "./state";
import { Badge, Chevron, CitationLink, Empty, SideTag, VenueBadge, cents, pct, shortDate, signedPct, signedUsd, smsHref, time, usd } from "./ui";

function pnlOf(p: PositionView) {
  const mark = p.currentPrice;
  if (mark == null || p.status !== "open") return { usd: p.realizedPnlUsd, pct: p.costBasisUsd > 0 ? p.realizedPnlUsd / p.costBasisUsd : 0, known: p.status !== "open" };
  const u = (mark - p.avgEntryPrice) * p.quantity;
  return { usd: u, pct: p.avgEntryPrice > 0 ? mark / p.avgEntryPrice - 1 : 0, known: true };
}

const THESIS: Record<NonNullable<PositionView["thesisStatus"]>, { label: string; tone: "good" | "warn" | "bad" }> = {
  intact: { label: "Thesis intact", tone: "good" },
  weakened: { label: "Thesis weakened", tone: "warn" },
  broken: { label: "Thesis broken", tone: "bad" },
};

function ThesisDot({ status }: { status?: PositionView["thesisStatus"] }) {
  if (!status) return null;
  const c = status === "intact" ? "bg-up" : status === "weakened" ? "bg-warn" : "bg-down";
  return <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${c}`} title={THESIS[status].label} aria-label={THESIS[status].label} />;
}

function Details({ p, events, onDone }: { p: PositionView; events: MonitorEvent[]; onDone: () => void }) {
  const t = p.thesisStatus ? THESIS[p.thesisStatus] : null;
  return (
    <div className="animate-fade grid gap-6 px-4 pb-5 pt-1 sm:px-5 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-4 text-sm">
        <div>
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <Label>Thesis</Label>
            {t ? <Badge tone={t.tone}>{t.label}</Badge> : <Badge>Not checked yet</Badge>}
            {p.thesisCheckedAt && <span className="text-[11px] text-subtle">checked {time(p.thesisCheckedAt)}</span>}
          </div>
          <p className="leading-relaxed text-fg-2">{p.thesis || "—"}</p>
        </div>
        {p.latestAssessment && (
          <div>
            <Label>Latest assessment</Label>
            <p className="mt-1 leading-relaxed text-fg-2">{p.latestAssessment}</p>
          </div>
        )}
        {(p.evidenceFor?.length || p.evidenceAgainst?.length) ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Evidence title="For" items={p.evidenceFor ?? []} tone="up" />
            <Evidence title="Against" items={p.evidenceAgainst ?? []} tone="down" />
          </div>
        ) : null}
        {p.citations && p.citations.length > 0 && (
          <div>
            <Label>Sources</Label>
            <ul className="mt-1 space-y-1 text-[13px]">
              {p.citations.slice(0, 5).map((c, i) => <li key={i}><CitationLink c={c} /></li>)}
            </ul>
          </div>
        )}
      </div>

      <div className="min-w-0 space-y-4 text-sm">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl bg-sunken p-4">
          <Fact k="Mayflower" v={pct(p.estimatedProbability)} />
          <Fact k="Market" v={pct(p.currentPrice ?? p.avgEntryPrice)} />
          <Fact k="Cost basis" v={usd(p.costBasisUsd)} />
          <Fact k="Opened" v={shortDate(p.openedAt)} />
          {p.stopPrice != null && <Fact k="Exit alert ≤" v={cents(p.stopPrice)} />}
          {p.takeProfitPrice != null && <Fact k="Take-profit ≥" v={cents(p.takeProfitPrice)} />}
        </dl>
        {p.sizingExplanation && (
          <div>
            <Label>Why this size</Label>
            <p className="mt-1 text-[13px] leading-relaxed text-fg-2">{p.sizingExplanation}</p>
          </div>
        )}
        {events.length > 0 && (
          <div>
            <Label>Monitor</Label>
            <ul className="mt-1.5 space-y-2">
              {events.slice(0, 4).map((e) => (
                <li key={e.id} className="text-[13px] leading-snug text-fg-2">
                  <span className="num text-[11px] text-subtle">{time(e.createdAt)}</span>{" "}
                  <Badge tone={e.recommendation === "hold" ? "neutral" : "warn"}>{e.recommendation}</Badge> {e.explanation}
                </li>
              ))}
            </ul>
          </div>
        )}
        {p.status === "open" && (
          <div className="flex flex-wrap items-start gap-3 border-t border-line pt-4">
            <PositionActions position={p} onDone={onDone} />
            <a href={smsHref(`How's my ${p.market.title} position looking?`)} className="ml-auto text-xs text-muted underline-offset-2 hover:text-fg hover:underline">
              Ask in iMessage
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

export function Positions({ positions, events, onChanged }: { positions: PositionView[]; events: MonitorEvent[]; onChanged: () => void }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const open = positions.filter((p) => p.status === "open");
  const closed = positions.filter((p) => p.status !== "open");
  const rows = showClosed ? [...open, ...closed] : open;

  if (positions.length === 0) {
    return <Empty>No positions yet. When you approve one of Mayflower&apos;s ideas, it shows up here with live marks and P&amp;L.</Empty>;
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
      {/* Desktop table */}
      <table className="hidden w-full table-fixed text-sm md:table">
        <thead>
          <tr className="border-b border-line text-left text-xs text-muted">
            <th className="py-3 pl-5 pr-3 font-normal">Market</th>
            <th className="w-16 px-3 py-3 font-normal">Side</th>
            <th className="w-16 px-3 py-3 text-right font-normal lg:w-20">Qty</th>
            <th className="w-16 px-3 py-3 text-right font-normal lg:w-20">Avg</th>
            <th className="w-16 px-3 py-3 text-right font-normal lg:w-20">Mark</th>
            <th className="w-24 px-3 py-3 text-right font-normal lg:w-28">Value</th>
            <th className="w-24 px-3 py-3 text-right font-normal lg:w-28">P&amp;L</th>
            <th className="w-20 px-3 py-3 text-right font-normal lg:w-24">Expires</th>
            <th className="w-10 py-3 pr-4" aria-label="Details" />
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const isOpen = openId === p.id;
            const pl = pnlOf(p);
            const value = (p.currentPrice ?? p.avgEntryPrice) * p.quantity;
            return (
              <Fragment key={p.id}>
                <tr
                  onClick={() => setOpenId(isOpen ? null : p.id)}
                  className={`cursor-pointer border-b border-line transition-colors last:border-0 ${isOpen ? "bg-raised" : "hover:bg-raised"} ${p.status !== "open" ? "opacity-60" : ""}`}
                >
                  <td className="py-3.5 pl-5 pr-3">
                    <div className="flex items-center gap-2">
                      <ThesisDot status={p.thesisStatus} />
                      <span className="truncate font-medium text-fg" title={p.market.title}>{p.market.title}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted">
                      <VenueBadge venue={p.venue} />
                      {p.market.eventTitle && p.market.eventTitle !== p.market.title && <span className="truncate">{p.market.eventTitle}</span>}
                      {p.status !== "open" && <Badge>closed</Badge>}
                    </div>
                  </td>
                  <td className="px-3 py-3.5"><SideTag side={p.side} /></td>
                  <td className="num px-3 py-3.5 text-right text-fg-2">{p.quantity.toLocaleString()}</td>
                  <td className="num px-3 py-3.5 text-right text-fg-2">{cents(p.avgEntryPrice)}</td>
                  <td className="num px-3 py-3.5 text-right text-fg">{cents(p.currentPrice)}</td>
                  <td className="num px-3 py-3.5 text-right text-fg">{usd(value)}</td>
                  <td className={`num px-3 py-3.5 text-right ${pl.usd > 0 ? "text-up" : pl.usd < 0 ? "text-down" : "text-muted"}`}>
                    <div>{pl.known ? signedUsd(pl.usd) : "—"}</div>
                    <div className="text-xs opacity-80">{pl.known ? signedPct(pl.pct) : ""}</div>
                  </td>
                  <td className="num px-3 py-3.5 text-right text-xs text-muted">{shortDate(p.market.expiresAt)}</td>
                  <td className="py-3.5 pr-4 text-right text-subtle"><Chevron open={isOpen} /></td>
                </tr>
                {isOpen && (
                  <tr className="border-b border-line bg-raised last:border-0">
                    <td colSpan={9}><Details p={p} events={events.filter((e) => e.positionId === p.id)} onDone={onChanged} /></td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>

      {/* Mobile list */}
      <ul className="divide-y divide-line md:hidden">
        {rows.map((p) => {
          const isOpen = openId === p.id;
          const pl = pnlOf(p);
          const value = (p.currentPrice ?? p.avgEntryPrice) * p.quantity;
          return (
            <li key={p.id} className={`${isOpen ? "bg-raised" : ""} ${p.status !== "open" ? "opacity-60" : ""}`}>
              <button type="button" onClick={() => setOpenId(isOpen ? null : p.id)} aria-expanded={isOpen} className="w-full px-4 py-3.5 text-left">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-2">
                      {p.thesisStatus && <span className="mt-[8px] flex"><ThesisDot status={p.thesisStatus} /></span>}
                      <span className="line-clamp-2 text-[15px] font-medium leading-snug text-fg">{p.market.title}</span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                      <SideTag side={p.side} />
                      <span className="num">{p.quantity} @ {cents(p.avgEntryPrice)} → {cents(p.currentPrice)}</span>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="num text-[15px] font-medium text-fg">{usd(value)}</div>
                    <div className={`num mt-0.5 text-xs ${pl.usd > 0 ? "text-up" : pl.usd < 0 ? "text-down" : "text-muted"}`}>
                      {pl.known ? `${signedUsd(pl.usd)} · ${signedPct(pl.pct, 1)}` : "—"}
                    </div>
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-2 text-[11px] text-subtle">
                  <VenueBadge venue={p.venue} />
                  <span>Expires {shortDate(p.market.expiresAt)}</span>
                  <span className="ml-auto"><Chevron open={isOpen} className="h-3.5 w-3.5" /></span>
                </div>
              </button>
              {isOpen && <Details p={p} events={events.filter((e) => e.positionId === p.id)} onDone={onChanged} />}
            </li>
          );
        })}
      </ul>

      {closed.length > 0 && (
        <button onClick={() => setShowClosed(!showClosed)} className="w-full border-t border-line px-5 py-3 text-left text-xs text-muted transition-colors hover:bg-raised hover:text-fg">
          {showClosed ? "Hide" : "Show"} {closed.length} closed position{closed.length === 1 ? "" : "s"}
        </button>
      )}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">{children}</span>;
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-muted">{k}</dt>
      <dd className="num mt-0.5 text-sm font-medium text-fg">{v}</dd>
    </div>
  );
}

function Evidence({ title, items, tone }: { title: string; items: { point: string; citation?: { title: string; url: string } }[]; tone: "up" | "down" }) {
  return (
    <div>
      <div className="flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 rounded-full ${tone === "up" ? "bg-up" : "bg-down"}`} aria-hidden />
        <Label>{title}</Label>
      </div>
      <ul className="mt-1.5 space-y-1.5 text-[13px] leading-snug text-fg-2">
        {items.slice(0, 3).map((e, i) => <li key={i}>{e.point}</li>)}
        {!items.length && <li className="text-subtle">None found.</li>}
      </ul>
    </div>
  );
}
