"use client";
import { useState } from "react";

type ProposalTerms = {
  id: string;
  kind: "close" | "reduce" | string;
  side: string;
  quantity: number;
  limitPrice: number;
  costUsd: number;
  riskNotes?: string;
};
type OrderResult = { status: string; filledQuantity: number; quantity: number; avgFillPrice?: number; limitPrice: number; mode?: string; error?: string };

const money = (n: number) => `$${n.toFixed(2)}`;
const btn =
  "rounded-md border border-stone-300 px-2.5 py-1 text-xs font-medium text-stone-700 hover:bg-stone-100 disabled:opacity-50 dark:border-stone-600 dark:text-stone-200 dark:hover:bg-stone-800";
const primary =
  "rounded-md bg-stone-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-stone-700 disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-300";

async function post<T>(url: string, body: unknown = {}): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok && json.error) throw new Error(json.error);
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return json;
}

function orderLine(o: OrderResult): string {
  const px = money(o.avgFillPrice ?? o.limitPrice);
  switch (o.status) {
    case "filled":
      return `Sold ${o.filledQuantity} at ${px}.`;
    case "partially_filled":
      return `Partially filled: ${o.filledQuantity}/${o.quantity} sold at ${px}. The rest is still working.`;
    case "open":
    case "submitted":
      return `Sell order placed (${o.status}), not filled yet. It will fill if a buyer meets ${money(o.limitPrice)}.`;
    default:
      return `Order ${o.status}${o.error ? `: ${o.error}` : ""}.`;
  }
}

/** Close / reduce buttons for one open position, with an inline confirmation of the exact sell terms. */
export default function PositionActions({
  position,
  onDone,
}: {
  position: { id: string; quantity: number; side: string; market: { title: string } };
  onDone?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [terms, setTerms] = useState<ProposalTerms | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function request(fraction: number) {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await post<{ proposal: ProposalTerms }>(`/api/positions/${position.id}/close`, { fraction });
      setTerms(r.proposal);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!terms) return;
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ ok: boolean; order?: OrderResult; error?: string }>(`/api/positions/${position.id}/close/confirm`, {
        proposalId: terms.id,
      });
      setTerms(null);
      if (r.order) setResult(orderLine(r.order));
      else setError(r.error ?? "Order failed.");
      onDone?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (position.quantity <= 0) return null;
  return (
    <div className="space-y-2 text-xs" onClick={(e) => e.stopPropagation()}>
      {!terms && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btn} disabled={busy} onClick={() => request(1)}>
            Close
          </button>
          {position.quantity >= 2 && (
            <button type="button" className={btn} disabled={busy} onClick={() => request(0.5)}>
              Reduce ½
            </button>
          )}
        </div>
      )}
      {terms && (
        <div className="space-y-2 rounded-md border border-stone-300 p-2.5 dark:border-stone-600" role="group" aria-label="Confirm sell">
          <p className="text-stone-800 dark:text-stone-100">
            Sell {terms.quantity} {terms.side} of &ldquo;{position.market.title}&rdquo; at ~{money(terms.limitPrice)} limit.
            Estimated proceeds {money(terms.costUsd)}.
          </p>
          <p className="text-stone-500 dark:text-stone-400">
            Limit order at the current bid. In thin markets it may fill partially or not at all; you can cancel it later.
          </p>
          <div className="flex gap-2">
            <button type="button" className={primary} disabled={busy} onClick={confirm}>
              {busy ? "Placing…" : `Confirm sell ${terms.quantity} @ ${money(terms.limitPrice)}`}
            </button>
            <button type="button" className={btn} disabled={busy} onClick={() => setTerms(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {result && <p className="text-stone-700 dark:text-stone-200">{result}</p>}
      {error && <p className="text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

/** "Cancel order" for a working (unfilled or partially filled) order. Filled contracts stay filled. */
export function OrderActions({ order, onDone }: { order: { id: string; status: string }; onDone?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!["submitted", "open", "partially_filled"].includes(order.status) && !msg) return null;

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ ok: boolean; order?: { status: string; filledQuantity: number }; error?: string }>(
        `/api/orders/${order.id}/cancel`,
      );
      if (!r.ok) throw new Error(r.error ?? "Could not cancel.");
      setMsg(r.order && r.order.filledQuantity > 0 ? `Cancelled the rest; ${r.order.filledQuantity} already filled.` : "Order cancelled.");
      onDone?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1 text-xs" onClick={(e) => e.stopPropagation()}>
      {!msg && (
        <button type="button" className={btn} disabled={busy} onClick={cancel}>
          {busy ? "Cancelling…" : "Cancel order"}
        </button>
      )}
      {msg && <p className="text-stone-700 dark:text-stone-200">{msg}</p>}
      {error && <p className="text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
