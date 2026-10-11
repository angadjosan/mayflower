"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button, Input } from "@/components/ui/primitives";

async function post(url: string, body?: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, data };
}

export function RejectButton({ proposalId }: { proposalId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await post(`/api/proposals/${proposalId}/reject`);
        router.refresh();
      }}
    >
      Reject
    </Button>
  );
}

export function DiscoverPanel() {
  const router = useRouter();
  const [focus, setFocus] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <form
      className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMsg(null);
        const r = await post("/api/discover", { focus: focus || null });
        setBusy(false);
        setMsg(r.ok ? String(r.data.summary ?? "Done") : String(r.data.error ?? "Failed"));
        router.refresh();
      }}
    >
      <Input className="sm:w-56" placeholder="Optional focus, e.g. crypto" value={focus} onChange={(e) => setFocus(e.target.value)} />
      <Button type="submit" disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {busy ? "Researching…" : "Find opportunities"}
      </Button>
      {msg ? <span className="self-center text-xs text-muted">{msg}</span> : null}
    </form>
  );
}

export function MonitorButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const r = await post("/api/monitor");
          setBusy(false);
          setMsg(r.ok ? String(r.data.summary ?? "Checked") : String(r.data.error ?? "Failed"));
          router.refresh();
        }}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Check positions now
      </Button>
      {msg ? <span className="text-xs text-muted">{msg}</span> : null}
    </span>
  );
}

export function CancelOrderButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await post(`/api/orders/${orderId}/cancel`);
        router.refresh();
      }}
    >
      Cancel
    </Button>
  );
}

export function PauseToggle({ paused }: { paused: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant={paused ? "primary" : "danger"}
      size="sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await post("/api/trading", { paused: !paused });
        setBusy(false);
        router.refresh();
      }}
    >
      {paused ? "Resume trading" : "Pause all trading"}
    </Button>
  );
}
