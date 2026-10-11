"use client";
import { useCallback, useEffect, useState } from "react";
import type { AuditReceipt } from "@/lib/types";
import { Badge, Button, Card, Empty, time } from "./ui";

const EXPLORER = "https://testnet.bscscan.com/tx/";

type Verify = { ok: boolean; hashMatches: boolean; onchainMatches?: boolean; error?: string };

const statusTone = (s: AuditReceipt["status"]) =>
  s === "committed" ? "good" : s === "failed" ? "warn" : s === "pending" ? "accent" : "neutral";

const short = (h: string, n = 10) => (h.length > n * 2 ? `${h.slice(0, n)}…${h.slice(-6)}` : h);

export default function Receipts() {
  const [receipts, setReceipts] = useState<AuditReceipt[]>([]);
  const [onchain, setOnchain] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verified, setVerified] = useState<Record<string, Verify | "checking">>({});

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/receipts", { cache: "no-store" });
      const data = await res.json();
      setReceipts(data.receipts ?? []);
      setOnchain(Boolean(data.onchainEnabled));
    } catch {
      setError("Couldn't load receipts.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function commitPolicy() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/receipts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "policy" }) });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "Commit failed.");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function verify(id: string) {
    setVerified((v) => ({ ...v, [id]: "checking" }));
    try {
      const res = await fetch(`/api/receipts?verify=${encodeURIComponent(id)}`, { cache: "no-store" });
      const result: Verify = res.ok ? await res.json() : { ok: false, hashMatches: false, error: "Not found" };
      setVerified((v) => ({ ...v, [id]: result }));
    } catch {
      setVerified((v) => ({ ...v, [id]: { ok: false, hashMatches: false, error: "Network error" } }));
    }
  }

  return (
    <Card
      title="Audit receipts"
      action={<Button onClick={commitPolicy} disabled={busy}>{busy ? "Committing…" : "Commit my policy"}</Button>}
    >
      <p className="mb-3 text-xs text-muted">
        Each approval and your trading policy (risk limits, trade-only, no withdrawals) is hashed and
        {onchain ? " committed to BNB Smart Chain testnet." : " recorded here. Onchain commits are off (no testnet key configured)."}{" "}
        Only a hash is stored onchain — no personal data.
      </p>
      {error && <div className="mb-3 text-xs text-down">{error}</div>}
      {loading ? (
        <div className="text-sm text-subtle">Loading…</div>
      ) : receipts.length === 0 ? (
        <Empty>No receipts yet. Approve a trade or commit your policy to create one.</Empty>
      ) : (
        <ul className="divide-y divide-line">
          {receipts.map((r) => {
            const v = verified[r.id];
            return (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm">
                <Badge tone={r.kind === "approval" ? "accent" : "neutral"}>{r.kind}</Badge>
                <code className="font-mono text-xs text-fg-2" title={r.hash}>sha256 {short(r.hash)}</code>
                <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                {r.txHash ? (
                  <a
                    href={`${EXPLORER}${r.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-xs text-accent underline decoration-line-strong underline-offset-2 hover:decoration-accent"
                  >
                    BscScan {short(r.txHash, 8)}
                  </a>
                ) : null}
                {r.error ? <span className="truncate text-xs text-warn" title={r.error}>{r.error}</span> : null}
                <span className="ml-auto flex items-center gap-2 text-xs text-subtle">
                  {v === "checking" ? (
                    "Checking…"
                  ) : v ? (
                    <span className={v.ok ? "text-up" : "text-down"}>
                      {v.ok ? (v.onchainMatches ? "Verified onchain" : "Hash verified") : v.error ?? "Mismatch"}
                    </span>
                  ) : (
                    <button onClick={() => verify(r.id)} className="text-accent hover:underline">Verify</button>
                  )}
                  <span>{time(r.createdAt)}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
