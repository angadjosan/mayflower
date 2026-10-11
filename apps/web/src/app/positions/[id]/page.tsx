import Link from "next/link";
import { notFound } from "next/navigation";
import { findHedges, evaluateExit } from "@mayflower/risk";
import { getContainer } from "@/lib/container";
import { getCurrentUser } from "@/lib/user";
import { ModeBadge } from "@/components/ModeBadge";

export const dynamic = "force-dynamic";

export default async function PositionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = getContainer();
  const user = await getCurrentUser();
  const pos = await c.repo.getPosition(id);
  if (!pos || !user || pos.userId !== user.id) notFound();
  const [market, original, latest, all, events] = await Promise.all([c.repo.getMarket(pos.marketId), pos.originalReportId ? c.repo.getReport(pos.originalReportId) : null, pos.latestReportId ? c.repo.getReport(pos.latestReportId) : null, c.repo.listPositions(user.id), c.repo.listMonitorEvents(user.id, 50)]);
  const hedges = findHedges(pos, all);
  const exits = evaluateExit(pos, market?.expiresAt);
  const mine = events.filter((e) => e.positionId === pos.id);
  return (
    <div className="space-y-4">
      <Link href="/" className="text-sm text-muted">← Dashboard</Link>
      <div className="card">
        <div className="flex items-center gap-2"><h1 className="font-semibold">{market?.title ?? pos.marketId}</h1><ModeBadge mode={pos.mode} /></div>
        <div className="text-sm text-muted">{pos.side} · {pos.quantity} contracts · entry {pos.avgPrice.toFixed(2)} · now {pos.currentPrice?.toFixed(2) ?? "—"} · invested ${pos.costBasis.toFixed(2)} · unrealized {pos.unrealizedPnl == null ? "—" : `$${pos.unrealizedPnl.toFixed(2)}`} · expires {market?.expiresAt?.slice(0, 10) ?? "?"}</div>
      </div>
      <div className="card text-sm space-y-2">
        <h2 className="font-semibold">Original thesis</h2><p>{original?.thesis ?? "—"}</p>
        <h2 className="font-semibold pt-2">Latest assessment</h2><p>{latest?.thesis ?? original?.thesis ?? "—"}</p>
        <h2 className="font-semibold pt-2">Risk</h2>
        <p>Max further loss: ${(pos.quantity * pos.avgPrice).toFixed(2)} (full cost basis). {hedges.length ? `Partially offset by ${hedges.length} opposite-side position(s).` : "No offsetting positions."}</p>
        {exits.length > 0 && <ul className="list-disc pl-4">{exits.map((e, i) => <li key={i}><span className="badge">{e.recommendation}</span> {e.detail}</li>)}</ul>}
        <h2 className="font-semibold pt-2">Watch conditions</h2>
        <ul className="list-disc pl-4">{(latest?.watchConditions ?? original?.watchConditions ?? []).map((w, i) => <li key={i}>{w}</li>)}</ul>
        <h2 className="font-semibold pt-2">Changes</h2>
        {mine.length ? mine.map((e) => <div key={e.id}><span className="text-xs text-muted">{new Date(e.createdAt).toLocaleString()}</span> · <span className="badge">{e.recommendation}</span> {e.summary}{e.proposalId && <Link className="ml-1 underline" href={`/proposals/${e.proposalId}`}>review proposal</Link>}</div>) : <div className="text-muted">No monitor events yet.</div>}
      </div>
    </div>
  );
}
