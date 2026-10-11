"use client";
import { useEffect, useRef, useState } from "react";
import type { MonitorEvent } from "@/lib/types";
import { Icon } from "./icons";
import PositionActions from "./PositionActions";
import { WhySheet } from "./Recommendations";
import type { PositionView } from "./state";
import { Badge, Chip, Eyebrow, IconButton, OddsBar, SideTag, SimulatedChip, VenueBadge, cents, pnlTone, shortDate, signedPct, signedUsd, time, usd } from "./ui";

function pnlOf(p: PositionView) {
  const mark = p.currentPrice;
  if (mark == null || p.status !== "open") return { usd: p.realizedPnlUsd, pct: p.costBasisUsd > 0 ? p.realizedPnlUsd / p.costBasisUsd : 0, known: p.status !== "open" };
  return { usd: (mark - p.avgEntryPrice) * p.quantity, pct: p.avgEntryPrice > 0 ? mark / p.avgEntryPrice - 1 : 0, known: true };
}

const HEALTH: Record<NonNullable<PositionView["thesisStatus"]>, { label: string; dot: string; tone: "up" | "warn" | "down" }> = {
  intact: { label: "Thesis intact", dot: "bg-up", tone: "up" },
  weakened: { label: "Thesis weakened", dot: "bg-warn", tone: "warn" },
  broken: { label: "Thesis broken", dot: "bg-down", tone: "down" },
};

function HealthDot({ status }: { status?: PositionView["thesisStatus"] }) {
  const h = status ? HEALTH[status] : null;
  return (
    <span
      className={`relative flex h-2.5 w-2.5 shrink-0 rounded-full ${h ? h.dot : "bg-line-strong"}`}
      title={h ? h.label : "Thesis not checked yet"}
      aria-label={h ? h.label : "Thesis not checked yet"}
    >
      {status === "broken" && <span className="absolute inset-0 animate-ping rounded-full bg-down opacity-60" />}
    </span>
  );
}

function RowMenu({ onDetails, onClose, canClose }: { onDetails: () => void; onClose: () => void; canClose: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", off);
    return () => document.removeEventListener("mousedown", off);
  }, [open]);
  return (
    <div className="relative" ref={ref} onClick={(e) => e.stopPropagation()}>
      <IconButton label="More" onClick={() => setOpen(!open)} aria-expanded={open} className="h-8 w-8"><Icon name="more" /></IconButton>
      {open && (
        <div role="menu" className="animate-pop absolute right-0 top-9 z-20 w-40 origin-top-right rounded-xl border border-line bg-surface p-1 shadow-[0_12px_32px_-12px_rgba(0,0,0,0.35)]">
          <MenuItem icon="info" onClick={() => { setOpen(false); onDetails(); }}>Why</MenuItem>
          {canClose && <MenuItem icon="x" onClick={() => { setOpen(false); onClose(); }}>Close / reduce</MenuItem>}
        </div>
      )}
    </div>
  );
}

function MenuItem({ icon, children, onClick }: { icon: "info" | "x"; children: React.ReactNode; onClick: () => void }) {
  return (
    <button role="menuitem" onClick={onClick} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-fg hover:bg-sunken">
      <Icon name={icon} className="h-3.5 w-3.5 text-muted" />{children}
    </button>
  );
}

function Expanded({ p, events, onDone, onWhy }: { p: PositionView; events: MonitorEvent[]; onDone: () => void; onWhy: () => void }) {
  const h = p.thesisStatus ? HEALTH[p.thesisStatus] : null;
  return (
    <div className="animate-fade space-y-4 px-4 pb-4 pt-1 sm:px-5" onClick={(e) => e.stopPropagation()}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Mini k="Cost" v={usd(p.costBasisUsd)} />
        <Mini k="Opened" v={shortDate(p.openedAt)} />
        <Mini k="Alert ≤" v={cents(p.stopPrice)} />
        <Mini k="Target ≥" v={cents(p.takeProfitPrice)} />
      </div>
      <div className="rounded-xl bg-sunken px-3 py-3">
        <div className="mb-2 flex items-center justify-between text-[11px] text-muted">
          <span>Price vs Mayflower</span>
          {h ? <Chip tone={h.tone}>{h.label.replace("Thesis ", "")}</Chip> : <Chip>Unchecked</Chip>}
        </div>
        <OddsBar market={p.currentPrice ?? p.avgEntryPrice} mine={p.estimatedProbability} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {p.status === "open" && <PositionActions position={p} onDone={onDone} />}
        <button onClick={onWhy} className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs text-muted hover:bg-sunken hover:text-fg">
          <Icon name="info" className="h-3.5 w-3.5" /> Why{events.length ? ` · ${events.length}` : ""}
        </button>
      </div>
    </div>
  );
}

function Mini({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-xl bg-sunken px-3 py-2">
      <div className="text-[11px] text-muted">{k}</div>
      <div className="num mt-0.5 text-[13px] font-medium text-fg">{v}</div>
    </div>
  );
}

export function Positions({ positions, events, onChanged }: { positions: PositionView[]; events: MonitorEvent[]; onChanged: () => void }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [whyId, setWhyId] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const open = positions.filter((p) => p.status === "open");
  const closed = positions.filter((p) => p.status !== "open");
  const rows = showClosed ? [...open, ...closed] : open;
  const why = positions.find((p) => p.id === whyId);

  if (positions.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-dashed border-line-strong px-4 py-5 text-sm text-muted">
        <Icon name="layers" className="h-5 w-5 text-subtle" />
        No positions yet
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
      <ul className="divide-y divide-line">
        {rows.map((p) => {
          const isOpen = openId === p.id;
          const pl = pnlOf(p);
          const value = (p.currentPrice ?? p.avgEntryPrice) * p.quantity;
          return (
            <li key={p.id} className={`${isOpen ? "bg-raised" : ""} ${p.status !== "open" ? "opacity-60" : ""}`}>
              <div
                role="button"
                tabIndex={0}
                aria-expanded={isOpen}
                onClick={() => setOpenId(isOpen ? null : p.id)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpenId(isOpen ? null : p.id); } }}
                className="flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-raised sm:px-5"
              >
                <HealthDot status={p.thesisStatus} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-fg" title={p.market.title}>{p.market.title}</div>
                  <div className="mt-1 flex items-center gap-1.5 text-xs text-muted">
                    <SideTag side={p.side} />
                    <span className="num">{p.quantity}</span>
                    <span className="num hidden min-[400px]:inline">· {cents(p.avgEntryPrice)} → {cents(p.currentPrice)}</span>
                    <span className="hidden sm:inline-flex"><VenueBadge venue={p.venue} /></span>
                    {p.mode === "simulated" && <SimulatedChip />}
                    {p.status !== "open" && <Badge>closed</Badge>}
                  </div>
                </div>
                <div className="num hidden w-20 text-right text-xs text-muted md:block" title="Expires">
                  {shortDate(p.market.expiresAt)}
                </div>
                <div className="shrink-0 text-right">
                  <div className="num text-sm font-medium text-fg">{usd(value)}</div>
                  <Chip tone={pnlTone(pl.usd)} className="mt-1 h-5 px-1.5 text-[11px]">
                    {pl.known ? signedPct(pl.pct, 1) : "—"}
                  </Chip>
                </div>
                <RowMenu canClose={p.status === "open"} onDetails={() => setWhyId(p.id)} onClose={() => setOpenId(p.id)} />
              </div>
              {isOpen && (
                <Expanded
                  p={p}
                  events={events.filter((e) => e.positionId === p.id)}
                  onDone={onChanged}
                  onWhy={() => setWhyId(p.id)}
                />
              )}
            </li>
          );
        })}
      </ul>

      {closed.length > 0 && (
        <button onClick={() => setShowClosed(!showClosed)} className="flex w-full items-center gap-1.5 border-t border-line px-5 py-2.5 text-xs text-muted transition-colors hover:bg-raised hover:text-fg">
          <Icon name="chevronDown" className={`h-3.5 w-3.5 transition-transform ${showClosed ? "rotate-180" : ""}`} />
          Closed · {closed.length}
        </button>
      )}

      {why && (
        <WhySheet
          open
          onClose={() => setWhyId(null)}
          title={
            <div>
              <div className="flex items-center gap-2"><HealthDot status={why.thesisStatus} />{why.market.title}</div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs font-normal">
                <SideTag side={why.side} />
                <Chip tone={pnlTone(pnlOf(why).usd)}>{signedUsd(pnlOf(why).usd)}</Chip>
                {why.thesisCheckedAt && <Chip><Icon name="clock" className="h-3 w-3" />{time(why.thesisCheckedAt)}</Chip>}
              </div>
            </div>
          }
          thesis={why.thesis}
          research={{
            id: "", marketId: why.marketId, createdAt: "", summary: why.researchSummary ?? "",
            evidenceFor: why.evidenceFor ?? [], evidenceAgainst: why.evidenceAgainst ?? [], citations: why.citations ?? [],
            estimatedProbability: why.estimatedProbability ?? 0, uncertainty: "medium", source: "context.dev",
          }}
          sizing={why.sizingExplanation}
          ask={`How's my ${why.market.title} position looking?`}
        >
          {why.latestAssessment && (
            <div>
              <Eyebrow>Latest</Eyebrow>
              <p className="mt-1 text-[13px] leading-relaxed text-fg-2">{why.latestAssessment}</p>
            </div>
          )}
          {events.some((e) => e.positionId === why.id) && (
            <div>
              <Eyebrow>Monitor</Eyebrow>
              <ul className="mt-1.5 space-y-2">
                {events.filter((e) => e.positionId === why.id).slice(0, 5).map((e) => (
                  <li key={e.id} className="text-[13px] leading-snug text-fg-2">
                    <Badge tone={e.recommendation === "hold" ? "neutral" : "warn"}>{e.recommendation}</Badge> {e.explanation}
                    <span className="num ml-1 text-[11px] text-subtle">{time(e.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </WhySheet>
      )}
    </div>
  );
}
