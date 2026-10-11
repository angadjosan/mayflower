import Link from "next/link";
import { notFound } from "next/navigation";
import { getContainer } from "@/lib/container";
import { getCurrentUser } from "@/lib/user";
import { ProposalCard } from "@/components/ProposalCard";

export const dynamic = "force-dynamic";

export default async function ProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = getContainer();
  const user = await getCurrentUser();
  const p = await c.repo.getProposal(id);
  if (!p || !user || p.userId !== user.id) notFound();
  const [market, report, approval] = await Promise.all([c.repo.getMarket(p.marketId), p.researchReportId ? c.repo.getReport(p.researchReportId) : null, c.repo.getApprovalForProposal(p.id, p.version)]);
  const order = approval ? await c.repo.getOrderByApproval(approval.id) : null;
  return (
    <div className="space-y-4">
      <Link href="/" className="text-sm text-muted">← Dashboard</Link>
      {p.status === "pending_approval" ? <ProposalCard p={p} title={market?.title ?? p.marketId} /> : <div className="card"><div className="font-medium">{market?.title}</div><div className="text-sm text-muted">Status: {p.status}{order ? ` · order ${order.status} (${order.mode})${order.exchangeOrderId ? ` · ${order.exchangeOrderId}` : ""}` : ""}</div></div>}
      <div className="card space-y-3 text-sm">
        <h2 className="font-semibold">Agent logic</h2>
        <Row k="What must happen" v={report?.whatMustHappen ?? "—"} />
        <Row k="Why now" v={report?.whyNow ?? "—"} />
        <Row k="Thesis" v={report?.thesis ?? "—"} />
        <Row k="Estimate vs market" v={report ? `${(report.estimatedProbability * 100).toFixed(0)}% (±${(report.uncertainty * 100).toFixed(0)}) vs ${report.marketProbability == null ? "?" : (report.marketProbability * 100).toFixed(0) + "%"}` : "—"} />
        <List k="Evidence for" items={report?.evidenceFor ?? []} />
        <List k="Evidence against" items={report?.evidenceAgainst ?? []} />
        <List k="What could go wrong" items={report?.risks ?? []} />
        <List k="Critic" items={report?.critique ?? []} />
        <List k="Watching for" items={report?.watchConditions ?? []} />
        <Row k="Resolution rules" v={market?.resolutionRules ?? "Not provided by venue — treat as a risk."} />
        <div>
          <div className="text-xs text-muted">Why this size</div>
          <div>{p.risk.explanation}</div>
          <ul className="mt-1 text-xs text-muted list-disc pl-4">{p.risk.constraints.map((k, i) => <li key={i}>{k.name}{k.bound ? " (binding)" : ""}: {k.detail}</li>)}</ul>
        </div>
        <div>
          <div className="text-xs text-muted">Sources</div>
          {report?.citations.length ? <ul className="list-disc pl-4">{report.citations.map((s, i) => <li key={i}><a className="underline" href={s.url} target="_blank" rel="noreferrer">{s.title}</a> <span className="badge">{s.stance}</span>{s.publishedAt && <span className="text-xs text-muted"> {s.publishedAt.slice(0, 10)}</span>}</li>)}</ul> : <div className="text-muted">No external citations.</div>}
        </div>
      </div>
    </div>
  );
}
function Row({ k, v }: { k: string; v: string }) { return <div><div className="text-xs text-muted">{k}</div><div>{v}</div></div>; }
function List({ k, items }: { k: string; items: string[] }) { return <div><div className="text-xs text-muted">{k}</div>{items.length ? <ul className="list-disc pl-4">{items.map((x, i) => <li key={i}>{x}</li>)}</ul> : <div className="text-muted">—</div>}</div>; }
