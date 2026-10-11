"use client";
import Link from "next/link";
import { useState } from "react";
import type { Order, ProposalStatus } from "@/lib/types";

function describe(o: Order) {
  const label = o.mode === "simulated" ? "simulated" : "sandbox";
  const fill = o.avgFillPrice !== undefined ? `$${o.avgFillPrice.toFixed(2)}` : `$${o.limitPrice.toFixed(2)}`;
  switch (o.status) {
    case "filled": return `Filled ${o.filledQuantity} at ${fill} (${label}).`;
    case "partially_filled": return `Partially filled: ${o.filledQuantity}/${o.quantity} at ${fill} (${label}). The rest is still working.`;
    case "open":
    case "submitted": return `Submitted, status: ${o.status} — not filled yet (${label}).`;
    default: return `Order ${o.status}${o.error ? `: ${o.error}` : ""} (${label}).`;
  }
}

export default function ApproveActions({
  proposalId, token, initialStatus, initialOrder,
}: {
  proposalId: string; token: string; initialStatus: ProposalStatus; initialOrder: Order | null;
}) {
  const [status, setStatus] = useState<ProposalStatus>(initialStatus);
  const [order, setOrder] = useState<Order | null>(initialOrder);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(kind: "approve" | "reject") {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/proposals/${proposalId}/${kind}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (data.order) setOrder(data.order);
      if (kind === "reject" && data.ok) setStatus("rejected");
      else if (kind === "approve" && data.order) setStatus(data.ok ? "executed" : "failed");
      if (!data.ok) setError(data.error ?? "Something went wrong.");
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (order) {
    const good = ["filled", "partially_filled", "open", "submitted"].includes(order.status);
    return (
      <div className={`animate-pop rounded-2xl border p-5 text-center text-sm ${good ? "border-line bg-surface" : "border-down/30 bg-down-soft"}`}>
        <div className={`mx-auto flex h-10 w-10 items-center justify-center rounded-full ${good ? "bg-up-soft text-up" : "bg-surface text-down"}`} aria-hidden>
          <svg viewBox="0 0 16 16" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            {good ? <path d="M3.5 8.5l3 3 6-7" /> : <path d="M8 4v5M8 11.5v.5" />}
          </svg>
        </div>
        <p className="mt-3 text-base font-semibold text-fg">{good ? "Order placed" : "Order not placed"}</p>
        <p className="mt-1 text-muted">{describe(order)}</p>
        {error && !good && <p className="mt-1 text-down">{error}</p>}
        <Link href="/" className="mt-4 inline-block text-[13px] text-fg-2 underline decoration-line-strong underline-offset-2 hover:text-fg">Open dashboard</Link>
      </div>
    );
  }

  if (status !== "pending") {
    return (
      <div className="rounded-2xl border border-line bg-surface p-4 text-center text-sm text-fg-2">
        This proposal is <strong className="font-medium text-fg">{status}</strong>.{status === "expired" && " Ask Mayflower for a fresh one; prices may have moved."}
        {error && <p className="mt-1 text-down">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {error && <p className="rounded-xl bg-down-soft p-3 text-sm text-down">{error}</p>}
      <button
        disabled={busy} onClick={() => call("approve")}
        className="h-12 w-full rounded-full bg-ink text-[15px] font-medium text-ink-fg transition-opacity hover:opacity-90 active:scale-[0.99] disabled:opacity-50"
      >
        {busy ? "Placing order…" : "Approve this exact order"}
      </button>
      <button
        disabled={busy} onClick={() => call("reject")}
        className="h-11 w-full rounded-full text-sm text-muted transition-colors hover:bg-sunken hover:text-fg disabled:opacity-50"
      >
        Reject
      </button>
    </div>
  );
}
