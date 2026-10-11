import Link from "next/link";
import { formatCents, formatPct, formatUsd, outcomeLabel, type Outcome, type SizingResult } from "@mayflower/shared";
import type { ProposalView } from "@/server/views";
import { Badge, Card, CardBody, buttonVariants } from "@/components/ui/primitives";
import { RejectButton } from "@/components/actions";
import { timeAgo } from "@/lib/utils";

export function ProbabilityBar({ market, estimate }: { market: number | null; estimate: number | null }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 text-xs">
        <span className="w-20 text-muted">Market</span>
        <div className="h-2 flex-1 rounded-full bg-surface-2">
          <div className="h-2 rounded-full bg-muted" style={{ width: `${Math.round((market ?? 0) * 100)}%` }} />
        </div>
        <span className="tabular w-10 text-right">{formatPct(market)}</span>
      </div>
      <div className="flex items-center gap-2 text-xs">
        <span className="w-20 text-muted">Mayflower</span>
        <div className="h-2 flex-1 rounded-full bg-surface-2">
          <div className="h-2 rounded-full bg-accent" style={{ width: `${Math.round((estimate ?? 0) * 100)}%` }} />
        </div>
        <span className="tabular w-10 text-right font-medium">{formatPct(estimate)}</span>
      </div>
    </div>
  );
}

export function ProposalCard({ view }: { view: ProposalView }) {
  const p = view.proposal;
  const s = p.sizing as Partial<SizingResult>;
  const forecast = view.report?.forecast;
  const pro = forecast?.evidenceFor?.[0];
  const con = forecast?.evidenceAgainst?.[0];
  const isSell = p.side === "sell";
  const demo = view.market?.source === "demo";
  const outcome = (p.outcome ?? "yes") as Outcome;
  return (
    <Card>
      <CardBody className="pt-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={p.discovery === "personalized" ? "info" : p.discovery === "monitor" ? "warning" : "neutral"}>
            {p.discovery === "personalized" ? "From your interests" : p.discovery === "general" ? "Broad market scan" : p.discovery === "monitor" ? "Position update" : "You asked"}
          </Badge>
          {demo ? <Badge tone="warning">DEMO market</Badge> : null}
          {p.status === "awaiting_link" ? <Badge tone="warning">Approved — waiting for Gemini link</Badge> : null}
          {p.rationale.uncertainty ? <Badge>{p.rationale.uncertainty} uncertainty</Badge> : null}
          <span className="ml-auto text-xs text-muted">{timeAgo(p.createdAt)}</span>
        </div>
        <Link href={`/proposals/${p.id}`} className="mt-3 block text-base font-semibold hover:underline">
          {p.rationale.title}
        </Link>
        <div className="mt-1 text-sm text-muted">
          {isSell ? "Sell" : "Buy"} <span className="font-medium text-text">{outcomeLabel(outcome)}</span> · {isSell ? "bid" : "price"} {formatCents(p.limitPrice)} ·{" "}
          {isSell ? `${p.quantity} contracts` : <>risk <span className="font-medium text-text">{formatUsd(p.maxCost)}</span> (max loss)</>}
        </div>
        {!isSell ? (
          <div className="mt-4">
            <ProbabilityBar market={p.marketProbability} estimate={s.rawProbability ?? p.estProbability} />
          </div>
        ) : null}
        <p className="mt-4 line-clamp-3 text-sm">{p.rationale.thesis}</p>
        {pro || con ? (
          <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            {pro ? (
              <div className="rounded-lg bg-positive-bg px-3 py-2">
                <div className="text-xs font-medium text-positive">For</div>
                <div className="mt-0.5 line-clamp-3">{pro.claim}</div>
              </div>
            ) : null}
            {con ? (
              <div className="rounded-lg bg-negative-bg px-3 py-2">
                <div className="text-xs font-medium text-negative">Against</div>
                <div className="mt-0.5 line-clamp-3">{con.claim}</div>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href={`/chat?ask=${encodeURIComponent(`Why do you recommend ${p.rationale.title}?`)}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
            Ask why
          </Link>
          {p.status === "pending" ? <RejectButton proposalId={p.id} /> : null}
          <Link href={`/proposals/${p.id}`} className={buttonVariants({ size: "sm" })}>
            Review &amp; approve
          </Link>
        </div>
      </CardBody>
    </Card>
  );
}
