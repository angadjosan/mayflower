import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { findHedges, prettyGroup } from "@mayflower/risk";
import { bidFor, formatCents, formatPct, formatUsd, outcomeLabel, type MarketContract, type Outcome, type SizingResult } from "@mayflower/shared";
import { requireUser } from "@/server/session";
import { getDb, schema } from "@/server/db/client";
import { contractFromRow, groupOf, latestQuotes, quoteFromRow, quoteHistory } from "@/server/markets";
import { marketData } from "@/server/integrations";
import { describeOrderStatus } from "@/server/execution";
import { Badge, Card, CardBody, CardHeader, CardTitle, Stat } from "@/components/ui/primitives";
import { ExitButtons } from "@/components/exit-buttons";
import { ModeBadge } from "@/components/feature-badge";
import { ValueChart } from "@/components/charts";
import { shortDate, timeAgo } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function PositionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const db = await getDb();
  const [row] = await db
    .select({ position: schema.positions, market: schema.markets })
    .from(schema.positions)
    .innerJoin(schema.markets, eq(schema.markets.symbol, schema.positions.symbol))
    .where(and(eq(schema.positions.id, id), eq(schema.positions.userId, user.id)))
    .limit(1);
  if (!row) notFound();
  const { position: pos, market } = row;
  const outcome = pos.outcome as Outcome;
  const quote = quoteFromRow((await latestQuotes([pos.symbol])).get(pos.symbol));
  const exit = quote ? bidFor(quote, outcome) : null;
  const value = exit !== null ? exit * pos.quantity : null;
  const [origin] = pos.originProposalId ? await db.select().from(schema.tradeProposals).where(eq(schema.tradeProposals.id, pos.originProposalId)).limit(1) : [];
  const [report] = origin?.researchReportId ? await db.select().from(schema.researchReports).where(eq(schema.researchReports.id, origin.researchReportId)).limit(1) : [];
  const events = await db.select().from(schema.monitorEvents).where(eq(schema.monitorEvents.positionId, pos.id)).orderBy(desc(schema.monitorEvents.createdAt)).limit(20);
  const related = await db
    .select({ p: schema.tradeProposals })
    .from(schema.tradeProposals)
    .where(and(eq(schema.tradeProposals.userId, user.id), eq(schema.tradeProposals.symbol, pos.symbol)))
    .orderBy(desc(schema.tradeProposals.createdAt));
  const orders = related.length
    ? await db.select().from(schema.orders).where(inArray(schema.orders.proposalId, related.map((r) => r.p.id))).orderBy(desc(schema.orders.createdAt))
    : [];
  const correlated = pos.correlationGroup
    ? await db
        .select({ p: schema.positions, m: schema.markets })
        .from(schema.positions)
        .innerJoin(schema.markets, eq(schema.markets.symbol, schema.positions.symbol))
        .where(and(eq(schema.positions.userId, user.id), eq(schema.positions.status, "open"), eq(schema.positions.correlationGroup, pos.correlationGroup), ne(schema.positions.id, pos.id)))
    : [];
  let hedges: ReturnType<typeof findHedges> = [];
  let hedgeError: string | null = null;
  if (pos.status === "open") {
    try {
      const contracts: MarketContract[] = await marketData().getEventContracts(pos.eventTicker);
      hedges = findHedges(
        { symbol: pos.symbol, eventTicker: pos.eventTicker, outcome, quantity: pos.quantity, avgPrice: pos.avgPrice, label: market.label, correlationGroup: pos.correlationGroup },
        contracts.length ? contracts : [contractFromRow(market, quote)],
        (m) => groupOf(m),
      );
    } catch (err) {
      hedgeError = (err as Error).message;
    }
  }
  const history = await quoteHistory(pos.symbol, 300);
  const pricePoints = history
    .map((q) => ({ ts: q.ts.toISOString(), value: (outcome === "yes" ? (q.sellYes ?? q.bestBid) : q.sellNo) ?? NaN }))
    .filter((p) => Number.isFinite(p.value))
    .map((p) => ({ ...p, value: p.value * pos.quantity }));
  const assessment = pos.latestAssessment;
  const sizing = origin?.sizing as Partial<SizingResult> | undefined;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <Link href="/dashboard" className="text-sm text-muted hover:text-text">
        ← Dashboard
      </Link>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={outcome === "yes" ? "positive" : "negative"}>{outcomeLabel(outcome)}</Badge>
        <Badge>{pos.status}</Badge>
        <ModeBadge mode={pos.mode} />
        {market.source === "demo" ? <Badge tone="warning">DEMO market</Badge> : null}
      </div>
      <h1 className="text-2xl font-semibold">{market.label}</h1>
      <p className="-mt-3 text-sm text-muted">{market.eventTitle} · expires {shortDate(market.expiry)} · {prettyGroup(pos.correlationGroup ?? "")}</p>

      <Card>
        <CardBody className="grid grid-cols-2 gap-5 pt-5 md:grid-cols-4">
          <Stat label="Quantity" value={pos.quantity} sub={`entry ${formatCents(pos.avgPrice)}`} />
          <Stat label="Current exit price" value={exit === null ? "no bid" : formatCents(exit)} />
          <Stat label="Invested" value={formatUsd(pos.costBasis)} sub="max loss if it resolves against you" />
          <Stat
            label={pos.status === "open" ? "Unrealized P&L" : "Realized P&L"}
            value={pos.status === "open" ? (value === null ? "—" : formatUsd(value - pos.costBasis, { signed: true })) : formatUsd(pos.realizedPnl, { signed: true })}
            tone={pos.status === "open" ? (value !== null && value - pos.costBasis < 0 ? "negative" : "positive") : pos.realizedPnl < 0 ? "negative" : "positive"}
          />
        </CardBody>
      </Card>

      {pos.status === "open" ? <ExitButtons positionId={pos.id} /> : null}

      <div className="grid gap-5 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Original thesis</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2 text-sm">
            <p>{pos.thesis?.text ?? "—"}</p>
            {origin ? (
              <p className="text-muted">
                At entry: market {formatPct(origin.marketProbability)}, Mayflower {formatPct(origin.estProbability)}.{" "}
                <Link href={`/proposals/${origin.id}`} className="text-accent underline">
                  Full reasoning
                </Link>
              </p>
            ) : null}
            <p className="text-muted">
              <span className="font-medium text-text">Why this size: </span>
              {pos.thesis?.sizingSummary ?? "—"}
            </p>
            {sizing?.capsApplied?.length ? <p className="text-xs text-muted">Limits applied: {sizing.capsApplied.map((c) => c.detail).join("; ")}.</p> : null}
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Latest assessment</CardTitle>
            {assessment ? <span className="text-xs text-muted">{timeAgo(assessment.at)}</span> : null}
          </CardHeader>
          <CardBody className="space-y-2 text-sm">
            {assessment ? (
              <>
                <div className="flex items-center gap-2">
                  <Badge tone={assessment.action === "hold" ? "positive" : "warning"}>{assessment.action}</Badge>
                  {assessment.heldProbability !== null ? (
                    <span className="text-muted">
                      Mayflower {formatPct(assessment.heldProbability)} vs. exit {formatCents(assessment.exitPrice)}
                    </span>
                  ) : null}
                </div>
                <p>{assessment.summary}</p>
                <ul className="list-disc pl-5 text-muted">
                  {assessment.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-muted">Not re-assessed yet. Mayflower checks open positions on a schedule, or use “Check positions now” on the dashboard.</p>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Position value over time</CardTitle>
        </CardHeader>
        <CardBody>
          <ValueChart points={pricePoints} />
        </CardBody>
      </Card>

      <div className="grid gap-5 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Watch / exit conditions</CardTitle>
          </CardHeader>
          <CardBody>
            <ul className="space-y-2 text-sm">
              {pos.watchConditions.map((w, i) => (
                <li key={i} className="rounded-lg bg-surface-2 px-3 py-2">
                  {w.description}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted">These trigger a recommendation and a message — never an automatic sale.</p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Correlation & hedges</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3 text-sm">
            {correlated.length ? (
              <p>
                Related open positions:{" "}
                {correlated.map((c, i) => (
                  <span key={c.p.id}>
                    {i ? ", " : ""}
                    <Link href={`/positions/${c.p.id}`} className="text-accent underline">
                      {c.m.label}
                    </Link>{" "}
                    ({formatUsd(c.p.costBasis)})
                  </span>
                ))}
                . They can lose together.
              </p>
            ) : (
              <p className="text-muted">No other open positions in this theme.</p>
            )}
            {hedges.length ? (
              hedges.map((h) => (
                <div key={h.symbol} className="rounded-lg border border-border px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Badge tone={h.relationship === "mutually_exclusive" ? "info" : "neutral"}>{h.relationship === "mutually_exclusive" ? "offsetting" : "related only"}</Badge>
                    <span className="font-medium">{h.label}</span>
                  </div>
                  <p className="mt-1">{h.explanation}</p>
                  {h.scenarios.length ? (
                    <ul className="tabular mt-1 text-xs text-muted">
                      {h.scenarios.map((s) => (
                        <li key={s.name}>
                          {s.name}: {formatUsd(s.pnl, { signed: true })}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <p className="mt-1 text-xs text-muted">{h.caveat}</p>
                </div>
              ))
            ) : (
              <p className="text-muted">{hedgeError ? `Couldn't load related contracts: ${hedgeError}` : "No genuinely offsetting contract found. Reducing the position is the cleaner way to cut risk."}</p>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Sources</CardTitle>
        </CardHeader>
        <CardBody>
          <ul className="space-y-1.5 text-sm">
            {[...(report?.citations ?? []), ...events.flatMap((e) => e.evidence)].map((c, i) => (
              <li key={`${c.id}-${i}`}>
                <a href={c.url} target="_blank" rel="noreferrer noopener" className="text-accent underline">
                  {c.title}
                </a>
                <span className="text-xs text-muted"> · {c.provider === "demo" ? "demo evidence" : "Context.dev"} · retrieved {timeAgo(c.retrievedAt)}</span>
              </li>
            ))}
            {!report?.citations.length && !events.some((e) => e.evidence.length) ? <li className="text-muted">No sources recorded.</li> : null}
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>History</CardTitle>
        </CardHeader>
        <CardBody>
          <ul className="space-y-2 text-sm">
            {orders.map((o) => (
              <li key={o.id}>
                <span className="text-xs text-muted">{o.createdAt.toLocaleString()} · </span>
                {describeOrderStatus(o)}
              </li>
            ))}
            {events.map((e) => (
              <li key={e.id}>
                <span className="text-xs text-muted">{e.createdAt.toLocaleString()} · </span>
                {e.summary}{" "}
                {e.proposalId ? (
                  <Link href={`/proposals/${e.proposalId}`} className="text-accent underline">
                    proposal
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
