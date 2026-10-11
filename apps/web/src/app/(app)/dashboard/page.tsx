import Link from "next/link";
import { formatCents, formatPct, formatUsd, outcomeLabel, type Outcome } from "@mayflower/shared";
import { prettyGroup } from "@mayflower/risk";
import { requireUser } from "@/server/session";
import { activeConnection, balanceInfo, defaultMode } from "@/server/gemini-link";
import { portfolioOverview, snapshots } from "@/server/portfolio";
import { proposalViews, recentOrders } from "@/server/views";
import { recentMonitorEvents } from "@/server/monitor";
import { describeOrderStatus } from "@/server/execution";
import { effectiveLimits } from "@/server/users";
import { Badge, Card, CardBody, CardHeader, CardTitle, EmptyState, Stat, buttonVariants } from "@/components/ui/primitives";
import { ProposalCard } from "@/components/proposal-card";
import { CancelOrderButton, DiscoverPanel, MonitorButton } from "@/components/actions";
import { ConcentrationBars, ValueChart } from "@/components/charts";
import { ModeBadge } from "@/components/feature-badge";
import { shortDate, timeAgo } from "@/lib/utils";

export const dynamic = "force-dynamic";

function pnlTone(v: number) {
  return v > 0 ? "positive" : v < 0 ? "negative" : null;
}

export default async function DashboardPage() {
  const user = await requireUser();
  const [balance, conn] = await Promise.all([balanceInfo(user.id), activeConnection(user.id)]);
  const overview = await portfolioOverview(user, balance);
  const [pending, passed, orders, events, snaps] = await Promise.all([
    proposalViews(user.id, ["pending", "awaiting_link"], 10),
    proposalViews(user.id, ["informational"], 5),
    recentOrders(user.id, 8),
    recentMonitorEvents(user.id, undefined, 8),
    snapshots(user.id),
  ]);
  const s = overview.summary;
  const limits = effectiveLimits(user);
  const totalPnl = s.unrealizedPnl + s.realizedPnl;
  const notLinked = !conn && defaultMode() === "needs_link";

  if (user.onboardingState !== "complete") {
    return (
      <Card>
        <CardBody className="pt-5">
          <h1 className="text-lg font-semibold">Welcome to Mayflower</h1>
          <p className="mt-1 text-sm text-muted">Tell Mayflower what you follow, what you believe, and how much you're comfortable risking. Text it in iMessage or use the web chat.</p>
          <Link href="/chat" className={buttonVariants({ className: "mt-4" })}>
            Start the conversation
          </Link>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header metrics */}
      <Card>
        <CardBody className="pt-5">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <ModeBadge mode={balance.mode} env={conn?.env} />
            <span className="text-xs text-muted">{balance.detail}</span>
            {notLinked ? (
              <Link href="/link" className="ml-auto text-xs font-medium text-accent hover:underline">
                Link Gemini (trade-only)
              </Link>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-5 md:grid-cols-4">
            <Stat label="Portfolio value" value={formatUsd(s.totalValue)} sub={s.noLiquidityPositions ? `${s.noLiquidityPositions} valued at cost (no bid)` : "cash + positions at exit price"} />
            <Stat label="Available funds" value={balance.available === null ? "—" : formatUsd(balance.available)} sub={overview.reserved ? `${formatUsd(overview.reserved)} reserved for open orders` : undefined} />
            <Stat label="P&L" value={formatUsd(totalPnl, { signed: true })} tone={pnlTone(totalPnl)} sub={`${formatUsd(s.unrealizedPnl, { signed: true })} unrealized · ${formatUsd(s.realizedPnl, { signed: true })} realized`} />
            <div>
              <Stat label="At risk / risk limit" value={`${formatUsd(s.atRisk)} / ${formatUsd(s.capacity)}`} sub={`max ${formatUsd(limits.maxPerPosition)} per position · ${limits.riskStyle}`} />
              <div className="mt-2 h-1.5 rounded-full bg-surface-2">
                <div className={`h-1.5 rounded-full ${s.capacityUsed > 0.85 ? "bg-negative" : "bg-accent"}`} style={{ width: `${Math.min(100, Math.round(s.capacityUsed * 100))}%` }} />
              </div>
            </div>
          </div>
          <p className="mt-4 text-sm text-muted">{s.explanation}</p>
        </CardBody>
      </Card>

      {/* Recommendations */}
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Recommendations</h2>
          <DiscoverPanel />
        </div>
        {pending.length === 0 ? (
          <EmptyState title="No pending recommendations">Ask Mayflower to find opportunities — or text it. “No trade” is a valid answer when nothing is compelling.</EmptyState>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {pending.map((v) => (
              <ProposalCard key={v.proposal.id} view={v} />
            ))}
          </div>
        )}
        {passed.length > 0 ? (
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-muted">Ideas Mayflower passed on ({passed.length})</summary>
            <ul className="mt-2 space-y-2">
              {passed.map((v) => (
                <li key={v.proposal.id} className="rounded-lg border border-border bg-surface px-3 py-2">
                  <Link href={`/proposals/${v.proposal.id}`} className="font-medium hover:underline">
                    {v.proposal.rationale.title}
                  </Link>
                  <span className="text-muted"> — market {formatPct(v.proposal.marketProbability)}, Mayflower {formatPct(v.proposal.estProbability)}. {v.proposal.rationale.noTradeReason}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      {/* Positions */}
      <Card>
        <CardHeader>
          <CardTitle>All positions</CardTitle>
          <MonitorButton />
        </CardHeader>
        <CardBody>
          {overview.positions.length === 0 ? (
            <EmptyState title="No open positions">Approved trades appear here once Gemini confirms a fill.</EmptyState>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="tabular w-full min-w-[760px] text-sm">
                <thead className="text-left text-xs text-muted">
                  <tr>
                    <th className="px-5 py-2 font-medium">Market</th>
                    <th className="py-2 font-medium">Side</th>
                    <th className="py-2 text-right font-medium">Qty</th>
                    <th className="py-2 text-right font-medium">Entry</th>
                    <th className="py-2 text-right font-medium">Current</th>
                    <th className="py-2 text-right font-medium">Invested</th>
                    <th className="py-2 text-right font-medium">Unrealized</th>
                    <th className="py-2 text-right font-medium">Risk</th>
                    <th className="px-5 py-2 text-right font-medium">Expires</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.positions.map((v) => (
                    <tr key={v.position.id} className="border-t border-border">
                      <td className="max-w-[260px] px-5 py-2.5">
                        <Link href={`/positions/${v.position.id}`} className="font-medium hover:underline">
                          {v.label}
                        </Link>
                        <div className="truncate text-xs text-muted">
                          {v.eventTitle} {v.source === "demo" ? "· DEMO" : ""} · {prettyGroup(v.position.correlationGroup ?? "")}
                        </div>
                      </td>
                      <td>
                        <Badge tone={v.position.outcome === "yes" ? "positive" : "negative"}>{outcomeLabel(v.position.outcome as Outcome)}</Badge>
                      </td>
                      <td className="text-right">{v.position.quantity}</td>
                      <td className="text-right">{formatCents(v.position.avgPrice)}</td>
                      <td className="text-right">{v.currentPrice === null ? <span className="text-muted">no bid</span> : formatCents(v.currentPrice)}</td>
                      <td className="text-right">{formatUsd(v.position.costBasis)}</td>
                      <td className={`text-right ${v.unrealizedPnl !== null && v.unrealizedPnl < 0 ? "text-negative" : v.unrealizedPnl ? "text-positive" : ""}`}>
                        {v.unrealizedPnl === null ? "—" : formatUsd(v.unrealizedPnl, { signed: true })}
                      </td>
                      <td className="text-right">{formatPct(s.capacity ? v.position.costBasis / s.capacity : 0)}</td>
                      <td className="px-5 text-right text-muted">{shortDate(v.expiry)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Performance */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Portfolio value</CardTitle>
            <div className="text-right text-xs text-muted">
              Sharpe ratio: <span className="font-medium text-text">{overview.sharpe.value === null ? `N/A (${overview.sharpe.reason})` : overview.sharpe.value}</span>
            </div>
          </CardHeader>
          <CardBody>
            <ValueChart points={snaps.map((p) => ({ ts: p.ts.toISOString(), value: p.totalValue }))} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Concentration</CardTitle>
          </CardHeader>
          <CardBody>
            <ConcentrationBars items={s.concentration.map((c) => ({ label: prettyGroup(c.group), atRisk: c.atRisk, share: c.share, positions: c.positions }))} />
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Orders */}
        <Card>
          <CardHeader>
            <CardTitle>Orders</CardTitle>
          </CardHeader>
          <CardBody>
            {orders.length === 0 ? (
              <EmptyState title="No orders yet">Orders are only ever sent after you approve exact terms.</EmptyState>
            ) : (
              <ul className="space-y-3">
                {orders.map(({ order, market }) => (
                  <li key={order.id} className="text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <ModeBadge mode={order.mode} simulated={order.simulated} env={order.env} />
                      <Badge tone={order.status === "filled" ? "positive" : order.status === "rejected" || order.status === "unknown" ? "negative" : "neutral"}>{order.status.replace("_", " ")}</Badge>
                      <span className="font-medium">{market.label}</span>
                      <span className="ml-auto text-xs text-muted">{timeAgo(order.createdAt)}</span>
                    </div>
                    <div className="mt-1 text-xs text-muted">{describeOrderStatus(order)}</div>
                    {["open", "partially_filled"].includes(order.status) ? <CancelOrderButton orderId={order.id} /> : null}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        {/* Monitoring alerts */}
        <Card>
          <CardHeader>
            <CardTitle>What Mayflower is watching</CardTitle>
          </CardHeader>
          <CardBody>
            {events.length === 0 ? (
              <EmptyState title="No alerts">Mayflower re-checks news and prices for open positions and only pings you for meaningful changes.</EmptyState>
            ) : (
              <ul className="space-y-3">
                {events.map((e) => (
                  <li key={e.id} className="text-sm">
                    <div className="flex items-center gap-2">
                      <Badge tone={e.severity === "high" ? "negative" : e.severity === "medium" ? "warning" : "neutral"}>{e.recommendation}</Badge>
                      <span className="ml-auto text-xs text-muted">{timeAgo(e.createdAt)}</span>
                    </div>
                    <div className="mt-1">{e.summary}</div>
                    {e.proposalId ? (
                      <Link href={`/proposals/${e.proposalId}`} className="text-xs font-medium text-accent hover:underline">
                        Review proposed adjustment →
                      </Link>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
