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
      <div className={`rounded-xl p-4 text-sm ${good ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-900"}`}>
        <p className="font-semibold">{good ? "Order placed" : "Order not placed"}</p>
        <p className="mt-1">{describe(order)}</p>
        {error && !good && <p className="mt-1">{error}</p>}
      </div>
    );
  }

  if (status !== "pending") {
    return (
      <div className="rounded-xl bg-neutral-100 p-4 text-sm text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
        This proposal is <strong>{status}</strong>.{status === "expired" && " Ask Mayflower for a fresh one — prices may have moved."}
        {error && <p className="mt-1 text-red-700">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      <button
        disabled={busy} onClick={() => call("approve")}
        className="w-full rounded-xl bg-neutral-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
      >
        {busy ? "Working…" : "Approve this exact order"}
      </button>
      <button
        disabled={busy} onClick={() => call("reject")}
        className="w-full rounded-xl border border-neutral-300 px-4 py-3 text-sm font-medium disabled:opacity-50 dark:border-neutral-700"
      >
        Reject
      </button>
    </div>
  );
}
