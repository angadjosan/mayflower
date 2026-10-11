import { formatCents, formatPct, formatUsd, type Citation, type EvidenceItem, type SizingResult } from "@mayflower/shared";
import type { ProposalView } from "@/server/views";
import { Badge, Card, CardBody, CardHeader, CardTitle } from "@/components/ui/primitives";
import { ProbabilityBar } from "@/components/proposal-card";
import { timeAgo } from "@/lib/utils";

function EvidenceList({ items, citations, tone }: { items: EvidenceItem[]; citations: Citation[]; tone: "positive" | "negative" }) {
  if (items.length === 0) return <p className="text-sm text-muted">{tone === "positive" ? "No supporting evidence found." : "No opposing evidence found — treat the estimate with extra caution."}</p>;
  return (
    <ul className="space-y-2">
      {items.map((e, i) => (
        <li key={i} className={`rounded-lg px-3 py-2 text-sm ${tone === "positive" ? "bg-positive-bg" : "bg-negative-bg"}`}>
          <div>{e.claim}</div>
          <div className="mt-1 flex flex-wrap gap-2 text-xs">
            <Badge>{e.weight}</Badge>
            {e.citationIds.map((id) => {
              const c = citations.find((x) => x.id === id);
              return c ? (
                <a key={id} href={c.url} target="_blank" rel="noreferrer noopener" className="text-accent underline">
                  {c.title}
                </a>
              ) : null;
            })}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ProposalReasoning({ view }: { view: ProposalView }) {
  const p = view.proposal;
  const report = view.report;
  const s = p.sizing as Partial<SizingResult> & { kind?: string; proceeds?: number; realizedVsCost?: number };
  const citations = report?.citations ?? [];
  const isExit = s.kind === "exit";
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>What has to happen</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3 text-sm">
          <p>{p.rationale.whatHasToHappen}</p>
          <p className="text-muted">
            <span className="font-medium text-text">Why now: </span>
            {p.rationale.whyNow}
          </p>
          <p className="text-muted">
            <span className="font-medium text-text">How Mayflower found it: </span>
            {p.rationale.discoveryReason}
          </p>
        </CardBody>
      </Card>

      {!isExit ? (
        <Card>
          <CardHeader>
            <CardTitle>Probability</CardTitle>
            <div className="text-xs text-muted">
              {p.rationale.method.forecast === "llm" ? "Google Gemini forecast + critic" : "Heuristic estimate (no LLM configured)"}
            </div>
          </CardHeader>
          <CardBody className="space-y-3">
            <ProbabilityBar market={p.marketProbability} estimate={s.rawProbability ?? p.estProbability} />
            <p className="text-sm">{p.rationale.thesis}</p>
            {p.rationale.criticIssues.length ? (
              <div className="rounded-lg bg-warning-bg px-3 py-2 text-sm text-warning">
                <div className="font-medium">Critic</div>
                <ul className="mt-1 list-disc pl-5">
                  {p.rationale.criticIssues.map((i) => (
                    <li key={i}>{i}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Why adjust</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2 text-sm">
            <p>{p.rationale.thesis}</p>
            {p.rationale.monitor?.reasons?.length ? (
              <ul className="list-disc pl-5 text-muted">
                {p.rationale.monitor.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            ) : null}
          </CardBody>
        </Card>
      )}

      {report ? (
        <Card>
          <CardHeader>
            <CardTitle>Evidence</CardTitle>
            <Badge tone={report.provider === "context.dev" ? "positive" : report.provider === "demo" ? "warning" : "negative"}>
              {report.provider === "context.dev" ? "Context.dev research" : report.provider === "demo" ? "Demo evidence — not real" : "No research available"}
            </Badge>
          </CardHeader>
          <CardBody className="grid gap-5 md:grid-cols-2">
            <div>
              <div className="mb-2 text-xs font-medium text-positive">Supports</div>
              <EvidenceList items={report.forecast.evidenceFor} citations={citations} tone="positive" />
            </div>
            <div>
              <div className="mb-2 text-xs font-medium text-negative">Contradicts</div>
              <EvidenceList items={report.forecast.evidenceAgainst} citations={citations} tone="negative" />
            </div>
            {citations.length ? (
              <div className="md:col-span-2">
                <div className="mb-2 text-xs font-medium text-muted">All sources ({citations.length})</div>
                <ul className="space-y-1.5 text-sm">
                  {citations.map((c) => (
                    <li key={c.id}>
                      <a href={c.url} target="_blank" rel="noreferrer noopener" className="text-accent underline">
                        {c.title}
                      </a>
                      <span className="text-xs text-muted">
                        {" "}
                        · retrieved {timeAgo(c.retrievedAt)}
                        {c.publishedAt ? ` · published ${new Date(c.publishedAt).toLocaleDateString()}` : ""}
                      </span>
                      <div className="line-clamp-2 text-xs text-muted">{c.snippet}</div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {report.errors.length ? <div className="text-xs text-negative md:col-span-2">{report.errors.join(" ")}</div> : null}
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{isExit ? "What you'd get back" : "Why this size"}</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3 text-sm">
          {isExit ? (
            <p>
              Selling {p.quantity} contracts at {formatCents(p.limitPrice)} returns about {formatUsd(s.proceeds ?? 0)} ({formatUsd(s.realizedVsCost ?? 0, { signed: true })} vs. what you paid for them).
            </p>
          ) : (
            <>
              <ol className="list-decimal space-y-1 pl-5">
                {(s.steps ?? []).map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              {p.decision === "trade" ? (
                <div className="grid grid-cols-3 gap-3 rounded-lg bg-surface-2 p-3 text-center">
                  <div>
                    <div className="text-xs text-muted">Max loss</div>
                    <div className="tabular font-semibold">{formatUsd(s.maxLoss)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted">Pays if right</div>
                    <div className="tabular font-semibold">{formatUsd(s.maxPayout)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted">Expected value</div>
                    <div className="tabular font-semibold">{formatUsd(s.expectedValue, { signed: true })}</div>
                  </div>
                </div>
              ) : null}
              {s.correlated && s.correlated.length ? (
                <p className="text-muted">
                  Related positions considered: {s.correlated.map((c) => `${c.label ?? c.symbol} (${formatUsd(c.atRisk)})`).join(", ")}.
                </p>
              ) : null}
              <p className="text-xs text-muted">
                Edge = estimated probability − purchase price (after an estimated fee). Sizing uses fractional Kelly on a probability shrunk toward the market, then hard limits enforced by Mayflower's risk engine — not the AI. Fees, spread, slippage and model error can erase an apparent edge.
              </p>
            </>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What could go wrong</CardTitle>
        </CardHeader>
        <CardBody className="grid gap-4 text-sm md:grid-cols-2">
          <div>
            <div className="mb-1 text-xs font-medium text-muted">Risks</div>
            <ul className="list-disc space-y-1 pl-5">
              {[...p.rationale.risks, ...p.rationale.resolutionRisks].map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
          <div>
            <div className="mb-1 text-xs font-medium text-muted">What would change Mayflower's mind / what it watches</div>
            <ul className="list-disc space-y-1 pl-5">
              {[...p.rationale.whatWouldChangeMind, ...p.rationale.watchConditions].map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
          {p.rationale.hedgeNote ? <p className="text-muted md:col-span-2">{p.rationale.hedgeNote}</p> : null}
          {view.market?.rulesUrl ? (
            <a href={view.market.rulesUrl} target="_blank" rel="noreferrer noopener" className="text-accent underline md:col-span-2">
              Read the contract's resolution rules on Gemini
            </a>
          ) : null}
        </CardBody>
      </Card>
      <p className="text-xs text-muted">Current market: YES ask {formatCents(view.currentQuote?.buyYes)}, bid {formatCents(view.currentQuote?.sellYes)} · implied {formatPct(p.marketProbability)} when proposed.</p>
    </div>
  );
}
