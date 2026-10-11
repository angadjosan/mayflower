"use client";
import { useCallback, useEffect, useState } from "react";
import type { AuditReceipt } from "@/lib/types";
import { Icon } from "./icons";
import { Button, Chip, InfoTip, Ring, time } from "./ui";

const EXPLORER = "https://testnet.bscscan.com/tx/";

type Verify = { ok: boolean; hashMatches: boolean; onchainMatches?: boolean; error?: string };

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

  const committed = receipts.filter((r) => r.status === "committed").length;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-4 shadow-card">
        <Ring value={receipts.length ? committed / receipts.length : 0} size={48} stroke={4.5} color="var(--up)" label={`${committed} of ${receipts.length} committed onchain`}>
          <Icon name="receipt" className="h-4 w-4 text-fg-2" />
        </Ring>
        <div className="min-w-0 flex-1">
          <div className="num text-sm font-semibold text-fg">{receipts.length} <span className="font-normal text-muted">receipts</span></div>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
            <span className={`h-1.5 w-1.5 rounded-full ${onchain ? "bg-up" : "bg-line-strong"}`} />
            {onchain ? "BNB testnet" : "Local only"}
          </div>
        </div>
        <InfoTip title="Audit receipts">
          <p>Each approval and your trading policy (risk limits, trade-only, no withdrawals) is hashed. {onchain ? "The hash is committed to BNB Smart Chain testnet." : "Onchain commits are off on this server (no testnet key)."}</p>
          <p>Only the hash goes onchain, never personal data.</p>
        </InfoTip>
        <Button size="sm" variant="outline" onClick={commitPolicy} disabled={busy}>
          <Icon name="shield" className="h-3.5 w-3.5" />{busy ? "…" : "Commit"}
        </Button>
      </div>
      {error && <div className="text-xs text-down">{error}</div>}
      {loading ? (
        <div className="h-16 animate-pulse rounded-2xl bg-sunken" />
      ) : receipts.length > 0 && (
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
          {receipts.map((r) => {
            const v = verified[r.id];
            const dot = r.status === "committed" ? "bg-up" : r.status === "failed" ? "bg-down" : r.status === "pending" ? "bg-warn" : "bg-line-strong";
            return (
              <li key={r.id} className="flex items-center gap-3 px-4 py-3">
                <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} title={r.status} aria-label={r.status} />
                <Chip className="h-5 px-1.5 text-[11px]">{r.kind}</Chip>
                <code className="min-w-0 flex-1 truncate font-mono text-xs text-fg-2" title={r.error ?? r.hash}>{short(r.hash)}</code>
                <span className="num hidden text-[11px] text-subtle sm:inline">{time(r.createdAt)}</span>
                {r.txHash && (
                  <a href={`${EXPLORER}${r.txHash}`} target="_blank" rel="noopener noreferrer" aria-label="View on BscScan" title="View on BscScan" className="flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-sunken hover:text-fg">
                    <Icon name="external" className="h-3.5 w-3.5" />
                  </a>
                )}
                {v === "checking" ? (
                  <Icon name="refresh" className="h-3.5 w-3.5 animate-spin text-muted" />
                ) : v ? (
                  <span title={v.ok ? (v.onchainMatches ? "Verified onchain" : "Hash verified") : v.error ?? "Mismatch"} className={v.ok ? "text-up" : "text-down"}>
                    <Icon name={v.ok ? "check" : "x"} className="h-4 w-4" />
                  </span>
                ) : (
                  <button onClick={() => verify(r.id)} className="h-7 rounded-full px-2.5 text-[11px] font-medium text-fg-2 hover:bg-sunken hover:text-fg">Verify</button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
