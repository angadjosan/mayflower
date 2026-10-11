"use client";
import { useState } from "react";
import type { ProposalView } from "./state";
import { Badge, Button, Card, CitationLink, Empty, cents, pct, usd } from "./ui";

const DISCOVERY: Record<ProposalView["discovery"], { label: string; tone: "accent" | "neutral" | "warn" }> = {
  personalized: { label: "For you", tone: "accent" },
  general: { label: "General", tone: "neutral" },
  monitor: { label: "Monitor", tone: "warn" },
  group: { label: "Group chat", tone: "accent" },
};

function ProposalCard({ p, onAsk, onReject }: { p: ProposalView; onAsk: (p: ProposalView) => void; onReject: (p: ProposalView) => void }) {
  const [open, setOpen] = useState(false);
  const r = p.research;
  const d = DISCOVERY[p.discovery] ?? DISCOVERY.general;
  const title = p.market.eventTitle && p.market.eventTitle !== p.market.title ? `${p.market.eventTitle}: ${p.market.title}` : p.market.title;
  return (
    <div className="rounded-xl border border-stone-200 p-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={d.tone}>{d.label}</Badge>
        {p.kind !== "open" && <Badge tone="warn">{p.kind === "close" ? "Close position" : "Reduce position"}</Badge>}
        {p.market.source === "mock" && <Badge>Mock market</Badge>}
        {p.market.expiresAt && <span className="text-xs text-stone-400">Expires {new Date(p.market.expiresAt).toLocaleDateString()}</span>}
      </div>
      <h3 className="mt-2 text-[15px] font-semibold leading-snug">{title}</h3>

      <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <div className="text-xs text-stone-500">Buy</div>
          <div className="font-semibold">
            <span className={p.side === "YES" ? "text-emerald-700" : "text-rose-700"}>{p.side}</span> at {cents(p.limitPrice)}
          </div>
          <div className="text-xs text-stone-400">market implies {pct(p.limitPrice)}</div>
        </div>
        <div>
          <div className="text-xs text-stone-500">Mayflower estimate</div>
          <div className="font-semibold">{pct(p.estimatedProbability)}</div>
          <div className="text-xs text-stone-400">{r ? `${r.uncertainty} uncertainty` : "uncertainty n/a"}</div>
        </div>
        <div>
          <div className="text-xs text-stone-500">Suggested</div>
          <div className="font-semibold">{usd(p.costUsd)}</div>
          <div className="text-xs text-stone-400">{p.quantity} contracts</div>
        </div>
        <div>
          <div className="text-xs text-stone-500">Max loss</div>
          <div className="font-semibold text-rose-600">{usd(p.kind === "open" ? p.costUsd : 0)}</div>
          <div className="text-xs text-stone-400">if it expires worthless</div>
        </div>
      </div>

      <p className="mt-3 text-sm leading-relaxed text-stone-700">{p.thesis}</p>

      <button onClick={() => setOpen(!open)} className="mt-2 text-sm font-medium text-indigo-600 hover:text-indigo-800">
        {open ? "Hide details" : "Why? See evidence"}
      </button>

      {open && (
        <div className="mt-3 space-y-3 rounded-lg bg-stone-50 p-3 text-sm">
          {r?.summary && <p className="text-stone-700">{r.summary}</p>}
          {r && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-emerald-700">Evidence for</div>
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
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-rose-700">Evidence against</div>
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

      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="ghost" onClick={() => onAsk(p)}>Ask why</Button>
        <Button variant="outline" onClick={() => onReject(p)}>Reject</Button>
        <a href={p.approvalUrl} className="ml-auto inline-flex items-center rounded-full bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700">
          Review &amp; Approve
        </a>
      </div>
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
    <Card title={`Recommendations${pending.length ? ` (${pending.length})` : ""}`}>
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
          placeholder="Optional focus, e.g. AI, NBA, Fed rates"
          className="min-w-0 flex-1 rounded-full border border-stone-200 bg-stone-50 px-4 py-1.5 text-sm outline-none focus:border-indigo-300 focus:bg-white"
        />
        <Button variant="primary" type="submit" disabled={discovering}>
          {discovering ? "Researching…" : "Find opportunities"}
        </Button>
      </form>
      {pending.length === 0 ? (
        <Empty>No open recommendations. &ldquo;No trade&rdquo; is a valid answer. Try Find opportunities.</Empty>
      ) : (
        <div className="space-y-3">
          {pending.map((p) => (
            <ProposalCard key={p.id} p={p} onAsk={onAsk} onReject={onReject} />
          ))}
        </div>
      )}
    </Card>
  );
}
