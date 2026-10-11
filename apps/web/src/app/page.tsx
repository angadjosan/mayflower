import Link from "next/link";
import { portfolioSnapshot } from "@mayflower/core";
import { getContainer } from "@/lib/container";
import { getCurrentUser, isDemoMode } from "@/lib/user";
import { ProposalCard } from "@/components/ProposalCard";
import { Chat } from "@/components/Chat";
import { ActionButtons } from "@/components/ActionButtons";
import { ExposureChart } from "@/components/PnlChart";
import { ModeBadge } from "@/components/ModeBadge";

export const dynamic = "force-dynamic";

const money = (n: number | null | undefined) => (n == null ? "—" : `${n < 0 ? "-" : ""}$${Math.abs(n).toFixed(2)}`);

export default async function Dashboard() {
  const c = getContainer();
  const user = await getCurrentUser();
  const status = c.status;
  if (!user) {
    return (
      <div className="space-y-6">
        <Hero />
        <Chat initial={[]} fallbackNote={status.imessage.mode === "live" ? "Web chat mirrors your iMessage conversation." : "iMessage bridge not configured — web chat is the active channel."} />
        <StatusRow status={status} />
      </div>
    );
  }
  const [snap, pending, messages, events, audit] = await Promise.all([
    portfolioSnapshot(c, user), c.repo.listProposals(user.id, ["pending_approval"]), c.repo.listMessages(user.id, 60), c.repo.listMonitorEvents(user.id, 10), c.repo.listAudit(user.id, 15),
  ]);
  const titles = new Map<string, string>();
  for (const id of new Set([...pending.map((p) => p.marketId), ...snap.positions.map((p) => p.marketId)])) titles.set(id, (await c.repo.getMarket(id))?.title ?? id);
  const open = snap.positions.filter((p) => p.status === "open");
  const total = (snap.availableBalance ?? 0) + open.reduce((s, p) => s + (p.currentPrice ?? p.avgPrice) * p.quantity, 0);

  return (
    <div className="space-y-6">
      {isDemoMode() && <div className="text-xs text-muted">Demo mode: in-memory data for this browser. Configure Supabase for persistence.</div>}
      <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Kpi k="Portfolio value" v={money(snap.availableBalance == null ? null : total)} sub={snap.availableBalance == null ? "link an exchange account" : status.exchange.detail} />
        <Kpi k="Available" v={money(snap.availableBalance)} />
        <Kpi k="Unrealized P&L" v={money(snap.pnl.unrealized)} tone={snap.pnl.unrealized} />
        <Kpi k="Realized P&L" v={money(snap.pnl.realized)} tone={snap.pnl.realized} />
        <Kpi k="At risk / budget" v={`$${snap.exposure.totalAtRisk.toFixed(0)} / $${snap.budget}`} sub={`${(snap.atRiskShare * 100).toFixed(0)}% used`} />
      </section>
      <p className="text-sm text-muted">{snap.exposure.explanation} Sharpe ratio: {snap.sharpe.reason}.</p>

      <section className="space-y-3">
        <div className="flex items-center justify-between"><h2 className="font-semibold">Recommendations</h2><ActionButtons /></div>
        {pending.length === 0 ? <div className="card text-sm text-muted">Nothing pending. Tell Mayflower what you believe, or click “Find opportunities”.</div> : <div className="grid md:grid-cols-2 gap-3">{pending.map((p) => <ProposalCard key={p.id} p={p} title={titles.get(p.marketId) ?? p.marketId} />)}</div>}
      </section>

      <section className="grid md:grid-cols-3 gap-4">
        <div className="md:col-span-2 space-y-3">
          <h2 className="font-semibold">Positions</h2>
          <div className="card overflow-x-auto">
            {open.length === 0 ? <div className="text-sm text-muted">No open positions.</div> : (
              <table className="w-full text-sm">
                <thead className="text-xs text-muted text-left"><tr><th className="py-1">Market</th><th>Side</th><th>Qty</th><th>Entry</th><th>Now</th><th>Invested</th><th>P&L</th><th></th></tr></thead>
                <tbody>{open.map((p) => (
                  <tr key={p.id} className="border-t border-border">
                    <td className="py-2 pr-2"><Link href={`/positions/${p.id}`} className="hover:underline">{titles.get(p.marketId)}</Link> <ModeBadge mode={p.mode} /></td>
                    <td>{p.side}</td><td>{p.quantity}</td><td>{p.avgPrice.toFixed(2)}</td><td>{p.currentPrice?.toFixed(2) ?? "—"}</td><td>${p.costBasis.toFixed(2)}</td>
                    <td className={p.unrealizedPnl == null ? "" : p.unrealizedPnl >= 0 ? "text-up" : "text-down"}>{money(p.unrealizedPnl)}</td>
                    <td className="text-xs text-muted">{snap.hedges[p.id]?.length ? "hedged" : ""}</td>
                  </tr>))}</tbody>
              </table>)}
          </div>
          <h2 className="font-semibold">Exposure by theme</h2>
          <div className="card"><ExposureChart data={snap.exposure.byTheme} /></div>
          <h2 className="font-semibold">Agent activity</h2>
          <div className="card text-sm space-y-1">
            {events.map((e) => <div key={e.id}><span className="badge">{e.recommendation}</span> {e.summary}{e.proposalId && <Link className="ml-1 underline" href={`/proposals/${e.proposalId}`}>review</Link>}</div>)}
            {audit.slice(0, 8).map((a) => <div key={a.id} className="text-xs text-muted">{new Date(a.createdAt).toLocaleTimeString()} · {a.actor} · {a.action}</div>)}
            {!events.length && !audit.length && <div className="text-muted">No activity yet.</div>}
          </div>
        </div>
        <div className="space-y-3">
          <h2 className="font-semibold">Talk to Mayflower</h2>
          <Chat initial={messages.map((m) => ({ role: m.role, text: m.text, channel: m.channel }))} fallbackNote={status.imessage.mode === "live" ? "Mirrors your iMessage thread." : "iMessage bridge not configured — web chat is the active channel."} />
        </div>
      </section>
      <StatusRow status={status} />
    </div>
  );
}

function Hero() {
  return <div className="card"><h1 className="text-xl font-semibold">Your personal AI hedge fund for prediction markets</h1><p className="text-sm text-muted mt-1">Tell Mayflower what you believe and how much you can risk. It researches, sizes the trade, and asks before placing anything.</p></div>;
}
function Kpi({ k, v, sub, tone }: { k: string; v: string; sub?: string; tone?: number }) {
  return <div className="card"><div className="text-xs text-muted">{k}</div><div className={`text-lg font-semibold ${tone == null || tone === 0 ? "" : tone > 0 ? "text-up" : "text-down"}`}>{v}</div>{sub && <div className="text-[11px] text-muted">{sub}</div>}</div>;
}
function StatusRow({ status }: { status: Record<string, { mode: string; detail: string }> }) {
  return <div className="flex flex-wrap gap-2 text-[11px] text-muted">{Object.entries(status).map(([k, v]) => <span key={k} className="badge">{k}: {v.mode}{v.detail ? ` · ${v.detail}` : ""}</span>)}</div>;
}
