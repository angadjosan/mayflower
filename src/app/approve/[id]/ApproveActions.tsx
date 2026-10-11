"use client";
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
      <div className={`animate-pop rounded-3xl p-5 text-center text-sm ${good ? "bg-money-500 text-white" : "bg-rose-50 text-rose-900"}`}>
        <div className={`mx-auto flex h-12 w-12 items-center justify-center rounded-full text-2xl font-bold ${good ? "bg-white text-money-600" : "bg-rose-100"}`} aria-hidden>
          {good ? "✓" : "!"}
        </div>
        <p className="mt-2 text-lg font-bold">{good ? "Order placed" : "Order not placed"}</p>
        <p className={`mt-1 ${good ? "text-white/85" : ""}`}>{describe(order)}</p>
        {error && !good && <p className="mt-1">{error}</p>}
      </div>
    );
  }

  if (status !== "pending") {
    return (
      <div className="rounded-2xl bg-stone-200/70 p-4 text-center text-sm text-stone-700">
        This proposal is <strong>{status}</strong>.{status === "expired" && " Ask Mayflower for a fresh one — prices may have moved."}
        {error && <p className="mt-1 text-rose-700">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {error && <p className="rounded-2xl bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
      <button
        disabled={busy} onClick={() => call("approve")}
        className="w-full rounded-full bg-money-600 px-4 py-4 text-base font-bold text-white shadow-[0_12px_24px_-12px_rgba(0,166,62,0.9)] transition-all hover:bg-money-700 active:scale-[0.97] disabled:opacity-50"
      >
        {busy ? "Placing order…" : "Approve this exact order"}
      </button>
      <button
        disabled={busy} onClick={() => call("reject")}
        className="w-full rounded-full px-4 py-3 text-sm font-semibold text-rose-500 transition-all hover:bg-rose-50 active:scale-[0.97] disabled:opacity-50"
      >
        Reject
      </button>
    </div>
  );
}
