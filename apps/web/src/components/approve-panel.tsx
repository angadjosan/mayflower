"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/primitives";

/**
 * Exact-terms approval. The terms hash shown to the user is sent back, so the
 * server only accepts an approval for precisely the order that was reviewed.
 */
export function ApprovePanel({ endpoint, termsHash, termsText, maxLoss, isSell, modeNote }: { endpoint: string; termsHash: string; termsText: string; maxLoss: string; isSell: boolean; modeNote: string }) {
  const router = useRouter();
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string; next?: string | null } | null>(null);

  async function approve() {
    setBusy(true);
    const res = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ termsHash }) });
    const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string; next?: string };
    setBusy(false);
    setResult({ ok: res.ok, message: data.message ?? data.error ?? (res.ok ? "Approved." : "Approval failed."), next: data.next });
    router.refresh();
  }

  if (result) {
    return (
      <div className={`rounded-lg px-4 py-3 text-sm ${result.ok ? "bg-positive-bg text-positive" : "bg-negative-bg text-negative"}`}>
        <div className="flex items-start gap-2">
          {result.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : null}
          <span>{result.message}</span>
        </div>
        {result.next ? (
          <a href={result.next} className="mt-2 inline-block font-medium underline">
            Continue →
          </a>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border bg-surface-2 px-4 py-3 text-sm">
        <div className="text-xs font-medium uppercase tracking-wide text-muted">Exact order</div>
        <div className="mt-1 font-medium">{termsText}</div>
        <div className="mt-1 text-xs text-muted">{modeNote}</div>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={ack} onChange={(e) => setAck(e.target.checked)} />
        <span>{isSell ? "I want to sell exactly this. The price may move and a limit order may not fill." : `I understand this contract can lose its full cost — up to ${maxLoss} — and that Mayflower's estimate can be wrong.`}</span>
      </label>
      <Button className="w-full" size="lg" disabled={!ack || busy} onClick={approve}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {busy ? "Submitting…" : isSell ? "Approve this sell order" : "Approve this exact order"}
      </Button>
    </div>
  );
}
