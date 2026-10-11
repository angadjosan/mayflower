"use client";
import { useState } from "react";
import { Icon } from "./icons";
import type { ProposalView } from "./state";
import { Chip, CitationLink, Eyebrow, IconButton, OddsBar, Sheet, SideTag, SimulatedChip, VenueBadge, cents, pct, relTime, smsHref, usd } from "./ui";

const KIND: Record<ProposalView["kind"], string | null> = { open: null, close: "Close", reduce: "Reduce", hedge: "Hedge" };

export function WhySheet({ open, onClose, title, thesis, research, sizing, risks, rules, ask, children }: {
  open: boolean; onClose: () => void; title: React.ReactNode; thesis?: string;
  research?: ProposalView["research"]; sizing?: string; risks?: string; rules?: string; ask?: string; children?: React.ReactNode;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div className="space-y-5 text-sm">
        {thesis && <p className="leading-relaxed text-fg">{thesis}</p>}
        {research && (research.evidenceFor.length > 0 || research.evidenceAgainst.length > 0) && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Points title="For" tone="up" items={research.evidenceFor} />
            <Points title="Against" tone="down" items={research.evidenceAgainst} />
          </div>
        )}
        {sizing && <Block label="Size">{sizing}</Block>}
        {risks && <Block label="Risks">{risks}</Block>}
        {research?.whatWouldChangeMind && <Block label="Would change our mind">{research.whatWouldChangeMind}</Block>}
        {research && research.citations.length > 0 && (
          <div>
            <Eyebrow>Sources</Eyebrow>
            <ul className="mt-1.5 space-y-1 text-[13px]">
              {research.citations.slice(0, 5).map((c, i) => <li key={i} className="truncate"><CitationLink c={c} /></li>)}
            </ul>
          </div>
        )}
        {rules && <Block label="Resolves">{rules}</Block>}
        {children}
        {ask && (
          <a href={smsHref(ask)} className="flex h-10 items-center justify-center gap-2 rounded-full border border-line-strong text-[13px] font-medium text-fg hover:bg-sunken">
            <Icon name="message" className="h-4 w-4" /> Ask Mayflower
          </a>
        )}
      </div>
    </Sheet>
  );
}

function Points({ title, tone, items }: { title: string; tone: "up" | "down"; items: { point: string }[] }) {
  return (
    <div>
      <Eyebrow className="flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 rounded-full ${tone === "up" ? "bg-up" : "bg-down"}`} aria-hidden />
        {title}
      </Eyebrow>
      <ul className="mt-1.5 space-y-1.5 text-[13px] leading-snug text-fg-2">
        {items.slice(0, 4).map((e, i) => <li key={i}>{e.point}</li>)}
        {!items.length && <li className="text-subtle">—</li>}
      </ul>
    </div>
  );
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Eyebrow>{label}</Eyebrow>
      <p className="mt-1 text-[13px] leading-relaxed text-fg-2">{children}</p>
    </div>
  );
}

function IdeaCard({ p, onReject }: { p: ProposalView; onReject: (p: ProposalView) => void }) {
  const [why, setWhy] = useState(false);
  const edgePts = Math.round(p.edge * 100);
  const kind = KIND[p.kind];
  const buying = p.kind === "open" || p.kind === "hedge";
  return (
    <article className="animate-rise flex flex-col rounded-2xl border border-line bg-surface p-4 shadow-card sm:p-5">
      <div className="flex items-center gap-1.5">
        <VenueBadge venue={p.venue} />
        {p.mode === "simulated" && <SimulatedChip />}
        {kind && <Chip tone="warn">{kind}</Chip>}
        {p.market.expiresAt && (
          <span className="ml-auto flex items-center gap-1 text-[11px] text-subtle" title={`Closes ${new Date(p.market.expiresAt).toLocaleDateString()}`}>
            <Icon name="clock" className="h-3 w-3" />{relTime(p.market.expiresAt).replace("in ", "")}
          </span>
        )}
      </div>

      <h3 className="mt-3 line-clamp-2 text-[15px] font-semibold leading-snug tracking-tight text-fg">{p.market.title}</h3>

      <div className="mt-3 flex items-center gap-1.5">
        <SideTag side={p.side} />
        <span className="num text-sm text-fg-2">{cents(p.limitPrice)}</span>
        <Chip tone={edgePts >= 0 ? "accent" : "down"} className="ml-auto" title="Edge: Mayflower's odds minus the price">
          {edgePts >= 0 ? "+" : ""}{edgePts} pts
        </Chip>
      </div>

      <div className="mt-3">
        <OddsBar market={p.limitPrice} mine={p.estimatedProbability} />
      </div>

      <div className="mt-auto flex items-center gap-1.5 pt-4">
        <Chip title={`${p.quantity} contracts · max loss ${buying ? usd(p.costUsd) : "—"}`}>
          <Icon name="wallet" className="h-3 w-3" />{usd(p.costUsd, 0)}
        </Chip>
        <IconButton label="Why" onClick={() => setWhy(true)} className="h-8 w-8"><Icon name="info" /></IconButton>
        <IconButton label="Reject" onClick={() => onReject(p)} className="h-8 w-8 hover:text-down"><Icon name="x" /></IconButton>
        <a
          href={p.approvalUrl}
          className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-full bg-ink pl-4 pr-3 text-[13px] font-medium text-ink-fg transition-opacity hover:opacity-90"
        >
          Approve <Icon name="arrowRight" className="h-3.5 w-3.5" />
        </a>
      </div>

      <WhySheet
        open={why}
        onClose={() => setWhy(false)}
        title={
          <div>
            <div>{p.market.title}</div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs font-normal">
              <SideTag side={p.side} />
              <Chip>{cents(p.limitPrice)} price</Chip>
              <Chip tone="accent">{pct(p.estimatedProbability)} Mayflower</Chip>
              <Chip>{p.quantity} × {cents(p.limitPrice)}</Chip>
            </div>
          </div>
        }
        ask={`Why ${p.market.title}?`}
        thesis={p.thesis}
        research={p.research}
        sizing={p.sizingExplanation}
        risks={p.riskNotes}
        rules={p.market.rules}
      />
    </article>
  );
}

/** Compact search that asks Mayflower to research new ideas. */
export function DiscoverForm({ onDiscover, discovering }: { onDiscover: (focus?: string) => void; discovering: boolean }) {
  const [focus, setFocus] = useState("");
  return (
    <form className="relative w-full sm:w-64" onSubmit={(e) => { e.preventDefault(); onDiscover(focus.trim() || undefined); }}>
      <Icon name={discovering ? "refresh" : "search"} className={`pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle ${discovering ? "animate-spin" : ""}`} />
      <input
        value={focus}
        onChange={(e) => setFocus(e.target.value)}
        placeholder={discovering ? "Researching…" : "Find ideas"}
        aria-label="Find ideas on a topic"
        disabled={discovering}
        className="h-9 w-full rounded-full border border-line-strong bg-surface pl-9 pr-10 text-[13px] text-fg outline-none transition placeholder:text-subtle focus:border-accent"
      />
      <button type="submit" disabled={discovering} aria-label="Search" className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-sunken text-fg-2 hover:text-fg disabled:opacity-40">
        <Icon name="sparkle" className="h-3.5 w-3.5" />
      </button>
    </form>
  );
}

export function Recommendations({ proposals, onReject }: { proposals: ProposalView[]; onReject: (p: ProposalView) => void }) {
  const pending = proposals.filter((p) => p.status === "pending");
  if (pending.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-dashed border-line-strong px-4 py-5 text-sm text-muted">
        <Icon name="target" className="h-5 w-5 text-subtle" />
        No edge right now
      </div>
    );
  }
  return (
    <div className={`grid gap-3 sm:grid-cols-2 ${pending.length >= 3 ? "lg:grid-cols-3" : ""}`}>
      {pending.map((p) => <IdeaCard key={p.id} p={p} onReject={onReject} />)}
    </div>
  );
}
