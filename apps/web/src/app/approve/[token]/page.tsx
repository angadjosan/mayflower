import Link from "next/link";
import { verifyApprovalLink } from "@mayflower/messaging";
import { approveAndExecute } from "@mayflower/core";
import { getContainer } from "@/lib/container";
import { ModeBadge } from "@/components/ModeBadge";

export const dynamic = "force-dynamic";

/**
 * Signed, expiring approval page. The token binds user + proposal + version +
 * hash, so this confirms exactly one order. Submitting the form executes it.
 */
export default async function ApprovePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ confirm?: string }> }) {
  const { token } = await params;
  const { confirm } = await searchParams;
  const secret = process.env.MAYFLOWER_APPROVAL_SECRET ?? "dev-approval-secret";
  const payload = verifyApprovalLink(token, secret);
  if (!payload) return <div className="card">This approval link is invalid or has expired. Ask Mayflower to resend it.</div>;
  const c = getContainer();
  const p = await c.repo.getProposal(payload.proposalId);
  if (!p) return <div className="card">Proposal not found.</div>;
  const market = await c.repo.getMarket(p.marketId);
  if (confirm === "1" && p.status === "pending_approval") {
    let result: { order?: { mode: string; status: string; exchangeOrderId: string | null; error?: string | null }; error?: string } = {};
    try {
      const { order } = await approveAndExecute(c, { userId: payload.userId, proposalId: payload.proposalId, version: payload.version, channel: "web", evidence: `signed-link:${token.slice(-8)}` });
      result = { order };
    } catch (e) { result = { error: (e as Error).message }; }
    if (result.error || !result.order) return <div className="card">Could not approve: {result.error}</div>;
    const order = result.order;
    return <div className="card space-y-2"><h1 className="font-semibold">Order submitted <ModeBadge mode={order.mode} /></h1><p className="text-sm">Exchange status: <b>{order.status}</b>{order.exchangeOrderId ? ` · id ${order.exchangeOrderId}` : ""}{order.error ? ` · ${order.error}` : ""}</p><p className="text-xs text-muted">{order.status === "filled" ? "Filled." : "Not filled yet — Mayflower will tell you when it is."}</p><Link href="/" className="underline text-sm">Dashboard</Link></div>;
  }
  return (
    <form className="card space-y-3" method="GET">
      <input type="hidden" name="confirm" value="1" />
      <h1 className="font-semibold">Confirm this exact order</h1>
      <div className="text-sm">{market?.title ?? p.marketId}</div>
      <div className="text-sm">{p.action} {p.quantity} × {p.side} at limit {p.limitPrice.toFixed(2)} · risk ${p.risk.stake} · max loss ${p.risk.maxLoss}</div>
      <p className="text-xs text-muted">Proposal {p.id.slice(0, 8)} v{p.version} · status {p.status} · expires {new Date(p.expiresAt).toLocaleString()}</p>
      {p.status === "pending_approval" ? <button className="btn btn-primary">Approve and place order</button> : <div className="text-sm">This proposal is {p.status}.</div>}
    </form>
  );
}
