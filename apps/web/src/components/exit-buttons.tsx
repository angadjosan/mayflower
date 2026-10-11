"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/primitives";

/** Creates a sell *proposal* — the user still reviews and approves exact terms. */
export function ExitButtons({ positionId }: { positionId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function propose(fraction: number) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/positions/${positionId}/exit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fraction }) });
    const data = (await res.json().catch(() => ({}))) as { proposalId?: string; error?: string };
    setBusy(false);
    if (!res.ok || !data.proposalId) return setError(data.error ?? "Couldn't prepare the order.");
    router.push(`/proposals/${data.proposalId}`);
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" disabled={busy} onClick={() => propose(0.5)}>
        Propose selling half
      </Button>
      <Button variant="outline" size="sm" disabled={busy} onClick={() => propose(1)}>
        Propose closing
      </Button>
      {error ? <span className="text-xs text-negative">{error}</span> : null}
    </div>
  );
}
