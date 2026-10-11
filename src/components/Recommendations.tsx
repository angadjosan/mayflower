"use client";
import { useState } from "react";
import type { ProposalView } from "./state";
import { Badge, Button, Card, CitationLink, Empty, cents, pct, usd } from "./ui";

const DISCOVERY: Record<ProposalView["discovery"], { label: string; tone: "accent" | "neutral" | "warn" }> = {
  personalized: { label: "✨ For you", tone: "accent" },
  general: { label: "🌎 Trending", tone: "neutral" },
  monitor: { label: "👀 Check-in", tone: "warn" },
  group: { label: "👥 Group chat", tone: "accent" },
};

function ProposalCard({ p, onAsk, onReject }: { p: ProposalView; onAsk: (p: ProposalView) => void; onReject: (p: ProposalView) => void }) {
  const [open, setOpen] = useState(false);
  const r = p.research;
  const d = DISCOVERY[p.discovery] ?? DISCOVERY.general;
  const title = p.market.eventTitle && p.market.eventTitle !== p.market.title ? `${p.market.eventTitle}: ${p.market.title}` : p.market.title;
  return (
    <div className="animate-rise rounded-3xl border border-stone-100 bg-gradient-to-b from-white to-stone-50/60 p-4 transition-shadow hover:shadow-[0_10px_30px_-18px_rgba(0,0,0,0.25)] sm:p-5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={d.tone}>{d.label}</Badge>
        {p.kind !== "open" && <Badge tone="warn">{p.kind === "close" ? "Close position" : p.kind === "hedge" ? "Hedge (partial)" : "Reduce position"}</Badge>}
        {p.market.source === "mock" && <Badge>Mock market</Badge>}
        {p.market.source === "polymarket" && <Badge tone="neutral">Polymarket</Badge>}
        {p.market.source === "hyperliquid" && <Badge tone="neutral">Hyperliquid</Badge>}
        {p.market.expiresAt && <span className="ml-auto text-xs text-stone-400">⏳ {new Date(p.market.expiresAt).toLocaleDateString()}</span>}
      </div>
      <h3 className="mt-2.5 text-[17px] font-bold leading-snug tracking-tight">{title}</h3>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <div
          className={`flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-2xl text-white shadow-[0_8px_20px_-10px_currentColor] ${
            p.side === "YES" ? "bg-money-500 text-money-600" : "bg-rose-500 text-rose-500"
          }`}
        >
          <span className="text-[11px] font-semibold text-white/80">BUY</span>
          <span className="text-lg font-extrabold leading-none text-white">{p.side}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-2xl font-extrabold tabular-nums tracking-tight">{usd(p.costUsd)}</div>
          <div className="text-xs text-stone-500">
            {p.quantity} contracts at {cents(p.limitPrice)} · max loss{" "}
            <span className="font-semibold text-rose-500">{usd(p.kind === "open" || p.kind === "hedge" ? p.costUsd : 0)}</span>
          </div>
        </div>
      </div>

      <OddsBar market={p.limitPrice} mine={p.estimatedProbability} uncertainty={r?.uncertainty} />

      <p className="mt-4 text-sm leading-relaxed text-stone-700">{p.thesis}</p>

      <button onClick={() => setOpen(!open)} className="mt-2 text-sm font-semibold text-imsg hover:text-imsg-dark" aria-expanded={open}>
        {open ? "Hide details ▴" : "See the evidence ▾"}
      </button>

      {open && (
        <div className="animate-rise mt-3 space-y-3 rounded-2xl bg-stone-100/70 p-4 text-sm">
          {r?.summary && <p className="text-stone-700">{r.summary}</p>}
          {r && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-money-700">👍 Evidence for</div>
                <ul className="space-y-1.5">
                  {r.evidenceFor.map((e, i) => (
                    <li key={i} className="text-stone-700">
                      {e.point} {e.citation && <span className="text-xs">(<CitationLink c={e.citation} />)</span>}
                    </li>
                  ))}
                  {!r.evidenceFor.length && <li className="text-stone-400">None found.</li>}
                </ul>
              </div>
              <div>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-rose-600">👎 Evidence against</div>
                <ul className="space-y-1.5">
                  {r.evidenceAgainst.map((e, i) => (
                    <li key={i} className="text-stone-700">
                      {e.point} {e.citation && <span className="text-xs">(<CitationLink c={e.citation} />)</span>}
                    </li>
                  ))}
                  {!r.evidenceAgainst.length && <li className="text-stone-400">None found.</li>}
                </ul>
              </div>
            </div>
          )}
          {r?.criticNotes && <Detail label="Critic notes">{r.criticNotes}</Detail>}
          {r?.whatWouldChangeMind && <Detail label="What would change our mind">{r.whatWouldChangeMind}</Detail>}
          <Detail label="Why this size">{p.sizingExplanation}</Detail>
          <Detail label="Risks">{p.riskNotes}</Detail>
          {r && r.citations.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-stone-500">Sources {r.source === "mock" && "(mock research)"}</div>
              <ul className="mt-1 space-y-0.5 text-xs">
                {r.citations.map((c, i) => (
                  <li key={i}><CitationLink c={c} /></li>
                ))}
              </ul>
            </div>
          )}
          {p.market.rules && <Detail label="Resolution rules">{p.market.rules}</Detail>}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button variant="ghost" onClick={() => onAsk(p)}>💬 Ask why</Button>
        <Button variant="outline" onClick={() => onReject(p)}>Pass</Button>
        <a
          href={p.approvalUrl}
          className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-money-600 px-5 py-2.5 text-sm font-bold text-white shadow-[0_8px_20px_-10px_rgba(0,166,62,0.9)] transition-all hover:-translate-y-px hover:bg-money-700 active:translate-y-0 active:scale-95"
        >
          Review &amp; approve <span aria-hidden>→</span>
        </a>
      </div>
    </div>
  );
}

function OddsBar({ market, mine, uncertainty }: { market: number; mine: number; uncertainty?: string }) {
  const edge = Math.round((mine - market) * 100);
  return (
    <div className="mt-4 rounded-2xl bg-stone-100/70 p-3">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-stone-500">Market says <span className="font-bold text-stone-800">{pct(market)}</span></span>
        <span className={`rounded-full px-2 py-0.5 font-bold ${edge >= 0 ? "bg-money-100 text-money-700" : "bg-rose-100 text-rose-600"}`}>
          {edge >= 0 ? "+" : ""}{edge} pts edge
        </span>
        <span className="font-medium text-stone-500">Mayflower says <span className="font-bold text-money-700">{pct(mine)}</span></span>
      </div>
      <div className="relative mt-2 h-2.5 rounded-full bg-stone-200">
        <div className="absolute inset-y-0 left-0 rounded-full bg-money-400/80 transition-[width] duration-700" style={{ width: `${Math.max(0, Math.min(1, mine)) * 100}%` }} />
        <div
          className="absolute -top-1 h-[18px] w-1 -translate-x-1/2 rounded-full bg-stone-800 ring-2 ring-white"
          style={{ left: `${Math.max(0, Math.min(1, market)) * 100}%` }}
          title="Market price"
        />
      </div>
      {uncertainty && <div className="mt-1.5 text-[11px] text-stone-400">{uncertainty} uncertainty</div>}
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  if (!children) return null;
  return (
    <div>
      <div className="text-xs font-semibold text-stone-500">{label}</div>
      <p className="text-stone-700">{children}</p>
    </div>
  );
}

export function Recommendations({
  proposals, onAsk, onReject, onDiscover, discovering,
}: {
  proposals: ProposalView[];
  onAsk: (p: ProposalView) => void;
  onReject: (p: ProposalView) => void;
  onDiscover: (focus?: string) => void;
  discovering: boolean;
}) {
  const [focus, setFocus] = useState("");
  const pending = proposals.filter((p) => p.status === "pending");
  return (
    <Card title={<>Ideas for you{pending.length ? <span className="ml-2 rounded-full bg-money-500 px-2 py-0.5 align-middle text-xs font-bold text-white">{pending.length}</span> : null}</>}>
      <form
        className="mb-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          onDiscover(focus.trim() || undefined);
        }}
      >
        <input
          value={focus}
          onChange={(e) => setFocus(e.target.value)}
          placeholder="🔍 Anything in mind? AI, NBA, Fed rates…"
          className="min-w-0 flex-1 rounded-full bg-stone-100 px-4 py-2 text-sm outline-none ring-money-400 transition focus:bg-white focus:ring-2"
        />
        <Button variant="primary" type="submit" disabled={discovering}>
          {discovering ? "Researching…" : "✨ Find ideas"}
        </Button>
      </form>
      {pending.length === 0 ? (
        <Empty><div className="mb-1 text-2xl" aria-hidden>🌊</div>Nothing worth betting on right now, and &ldquo;no trade&rdquo; is a fine answer. Tap Find ideas to look again.</Empty>
      ) : (
        <div className="space-y-4">
          {pending.map((p) => (
            <ProposalCard key={p.id} p={p} onAsk={onAsk} onReject={onReject} />
          ))}
        </div>
      )}
    </Card>
  );
}
