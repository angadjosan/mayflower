"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { TradeProposal } from "@mayflower/shared";

export function ProposalCard({ p, title }: { p: TradeProposal; title: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();
  const act = async (action: "approve" | "reject") => {
    setBusy(action);
    const r = await fetch(`/api/proposals/${p.id}/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: p.version }) });
    const j = await r.json();
    setMsg(r.ok ? (action === "approve" ? `Order ${j.order.status}${j.order.mode !== "live" ? ` (${j.order.mode})` : ""}${j.order.error ? `: ${j.order.error}` : ""}` : "Rejected") : j.error);
    setBusy(null);
    router.refresh();
  };
  const r = p.risk;
  return (
    <div className="card space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs text-muted">{p.discoveryReason === "personalized" ? "From your interests" : p.discoveryReason === "monitor" ? "Position update" : "General market"}</div>
          <div className="font-medium">{title}</div>
        </div>
        <span className="badge">{p.action} {p.side}</span>
      </div>
      <p className="text-sm">{p.summary}</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
        <Stat k="Risk" v={`$${r.stake}`} /><Stat k="Max loss" v={`$${r.maxLoss}`} /><Stat k="Max gain" v={`$${r.maxGain}`} /><Stat k="Limit" v={r.limitPrice.toFixed(2)} />
      </div>
      <p className="text-xs text-muted">{r.explanation}</p>
      <div className="flex flex-wrap gap-2 pt-1">
        <Link className="btn" href={`/proposals/${p.id}`}>Ask why</Link>
        <button className="btn" disabled={!!busy} onClick={() => act("reject")}>Reject</button>
        <button className="btn btn-primary" disabled={!!busy} onClick={() => act("approve")}>{busy === "approve" ? "Submitting…" : "Review & approve"}</button>
      </div>
      {msg && <div className="text-sm">{msg}</div>}
    </div>
  );
}
function Stat({ k, v }: { k: string; v: string }) { return <div><div className="text-xs text-muted">{k}</div><div className="font-medium">{v}</div></div>; }
