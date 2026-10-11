"use client";
import { useState } from "react";
import type { ProposalView } from "./state";
import { Badge, Button, Chevron, CitationLink, Empty, SideTag, VenueBadge, cents, pct, relTime, smsHref, usd } from "./ui";

const DISCOVERY: Record<ProposalView["discovery"], string> = {
  personalized: "For you",
  general: "Trending",
  monitor: "Check-in",
  group: "Group chat",
};
const KIND: Record<ProposalView["kind"], string | null> = { open: null, close: "Close", reduce: "Reduce", hedge: "Hedge" };

/** Market price vs Mayflower's probability for the chosen side, on one 0–100 track. */
function ProbBar({ market, mine }: { market: number; mine: number }) {
  const m = Math.max(0, Math.min(1, market)) * 100;
  const y = Math.max(0, Math.min(1, mine)) * 100;
  const lo = Math.min(m, y), hi = Math.max(m, y);
  return (
    <div>
      <div className="relative h-1.5 rounded-full bg-sunken">
        {/* Gap between price and estimate = the edge */}
        <div className={`absolute inset-y-0 rounded-full ${y >= m ? "bg-accent/35" : "bg-down/35"}`} style={{ left: `${lo}%`, width: `${hi - lo}%` }} />
        <div className="absolute top-1/2 h-3 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted" style={{ left: `${m}%` }} title="Market price" />
        <div className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-accent" style={{ left: `${y}%` }} title="Mayflower estimate" />
      </div>
      <div className="num mt-2 flex justify-between text-[11px] text-muted">
        <span>Price <span className="text-fg-2">{cents(market)}</span></span>
        <span>Mayflower <span className="text-accent">{pct(mine)}</span></span>
      </div>
    </div>
  );
}

function IdeaCard({ p, onReject }: { p: ProposalView; onReject: (p: ProposalView) => void }) {
  const [open, setOpen] = useState(false);
  const r = p.research;
  const edgePts = Math.round(p.edge * 100);
  const kind = KIND[p.kind];
  const buying = p.kind === "open" || p.kind === "hedge";
  return (
    <article className="animate-rise flex flex-col rounded-2xl border border-line bg-surface p-5 shadow-card">
      <div className="flex flex-wrap items-center gap-1.5">
        <VenueBadge venue={p.venue} />
        <Badge>{DISCOVERY[p.discovery] ?? "Idea"}</Badge>
        {kind && <Badge tone="warn">{kind}</Badge>}
        {p.market.source === "mock" && <Badge>Mock market</Badge>}
        {p.market.expiresAt && <span className="ml-auto text-[11px] text-subtle">Closes {relTime(p.market.expiresAt)}</span>}
      </div>

      <h3 className="mt-3 text-[16px] font-semibold leading-snug tracking-tight text-fg">{p.market.title}</h3>
      {p.market.eventTitle && p.market.eventTitle !== p.market.title && <p className="mt-0.5 truncate text-[13px] text-muted">{p.market.eventTitle}</p>}

      <div className="mt-4 flex items-end justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-fg-2">{buying ? "Buy" : "Sell"}</span>
          <SideTag side={p.side} />
          <span className="num text-sm text-fg-2">at {cents(p.limitPrice)}</span>
        </div>
        <div className={`num text-right text-sm font-medium ${edgePts >= 0 ? "text-accent" : "text-down"}`}>
          {edgePts >= 0 ? "+" : ""}{edgePts} pts <span className="text-xs font-normal text-muted">edge</span>
        </div>
      </div>

      <div className="mt-3">
        <ProbBar market={p.limitPrice} mine={p.estimatedProbability} />
      </div>

      <dl className="num mt-4 grid grid-cols-3 gap-3 border-y border-line py-3 text-[13px]">
        <div><dt className="text-[11px] text-muted">Size</dt><dd className="mt-0.5 font-medium text-fg">{usd(p.costUsd)}</dd></div>
        <div><dt className="text-[11px] text-muted">Contracts</dt><dd className="mt-0.5 font-medium text-fg">{p.quantity}</dd></div>
        <div><dt className="text-[11px] text-muted">Max loss</dt><dd className="mt-0.5 font-medium text-fg">{buying ? usd(p.costUsd) : "—"}</dd></div>
      </dl>

      <p className={`mt-3 text-[13px] leading-relaxed text-fg-2 ${open ? "" : "line-clamp-3"}`}>{p.thesis}</p>

      {open && (
        <div className="animate-fade mt-3 space-y-3 text-[13px]">
          {r && (
            <div className="grid gap-3 sm:grid-cols-2">
              <EvidenceList title="For" tone="up" items={r.evidenceFor} />
              <EvidenceList title="Against" tone="down" items={r.evidenceAgainst} />
            </div>
          )}
          {p.sizingExplanation && <Detail label="Why this size">{p.sizingExplanation}</Detail>}
          {p.riskNotes && <Detail label="Risks">{p.riskNotes}</Detail>}
          {r && r.citations.length > 0 && (
            <div>
              <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Sources</div>
              <ul className="mt-1 space-y-0.5">
                {r.citations.slice(0, 4).map((c, i) => <li key={i} className="truncate"><CitationLink c={c} /></li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      <button onClick={() => setOpen(!open)} className="mt-2 inline-flex items-center gap-1 self-start text-xs text-muted hover:text-fg" aria-expanded={open}>
        {open ? "Less" : "Evidence & sizing"} <Chevron open={open} className="h-3 w-3" />
      </button>

      <div className="mt-auto flex items-center gap-2 pt-4">
        <Button variant="ghost" size="sm" onClick={() => onReject(p)}>Reject</Button>
        <a href={smsHref(`Why ${p.market.title}?`)} className="hidden text-xs text-muted hover:text-fg min-[400px]:inline">Ask why</a>
        <a
          href={p.approvalUrl}
          className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-full bg-ink px-4 text-[13px] font-medium text-ink-fg transition-opacity hover:opacity-90"
        >
          Review &amp; approve
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden><path d="M3 8h10M9 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </a>
      </div>
    </article>
  );
}

function EvidenceList({ title, tone, items }: { title: string; tone: "up" | "down"; items: { point: string }[] }) {
  return (
    <div>
      <div className="flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 rounded-full ${tone === "up" ? "bg-up" : "bg-down"}`} aria-hidden />
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">{title}</span>
      </div>
      <ul className="mt-1 space-y-1 leading-snug text-fg-2">
        {items.slice(0, 3).map((e, i) => <li key={i}>{e.point}</li>)}
        {!items.length && <li className="text-subtle">None found.</li>}
      </ul>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">{label}</div>
      <p className="mt-0.5 leading-relaxed text-fg-2">{children}</p>
    </div>
  );
}

/** Small search form that asks Mayflower to research new ideas. */
export function DiscoverForm({ onDiscover, discovering }: { onDiscover: (focus?: string) => void; discovering: boolean }) {
  const [focus, setFocus] = useState("");
  return (
    <form
      className="flex w-full gap-2 sm:w-auto"
      onSubmit={(e) => { e.preventDefault(); onDiscover(focus.trim() || undefined); }}
    >
      <input
        value={focus}
        onChange={(e) => setFocus(e.target.value)}
        placeholder="Fed rates, BTC, NBA…"
        aria-label="Topic to research"
        className="h-9 min-w-0 flex-1 rounded-full border border-line-strong bg-surface px-3.5 text-[13px] text-fg outline-none transition placeholder:text-subtle focus:border-accent sm:w-52 sm:flex-none"
      />
      <Button variant="outline" size="sm" type="submit" disabled={discovering} className="h-9">
        {discovering ? "Researching…" : "Find ideas"}
      </Button>
    </form>
  );
}

export function Recommendations({ proposals, onReject }: { proposals: ProposalView[]; onReject: (p: ProposalView) => void }) {
  const pending = proposals.filter((p) => p.status === "pending");
  if (pending.length === 0) {
    return (
      <Empty>
        Nothing worth trading right now, and &ldquo;no trade&rdquo; is a fine answer. Mayflower keeps scanning and will text you when it finds an edge.
      </Empty>
    );
  }
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {pending.map((p) => <IdeaCard key={p.id} p={p} onReject={onReject} />)}
    </div>
  );
}
