"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/primitives";

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function run(url: string, body?: unknown) {
    setBusy(true);
    setMsg(null);
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const data = (await res.json().catch(() => ({}))) as { error?: string; submitted?: string[] };
    setBusy(false);
    setMsg({ ok: res.ok, text: res.ok ? (data.submitted?.length ? data.submitted.join(" ") : "Done.") : (data.error ?? "Failed.") });
    router.refresh();
  }
  return { busy, msg, run };
}

export function AcceptTermsButton() {
  const { busy, msg, run } = useAction();
  return (
    <div className="space-y-2">
      <Button disabled={busy} onClick={() => run("/api/gemini/terms")}>
        I accept Gemini's prediction-market terms
      </Button>
      {msg ? <p className={`text-sm ${msg.ok ? "text-positive" : "text-negative"}`}>{msg.text}</p> : null}
    </div>
  );
}

export function FallbackModeButtons({ shared }: { shared: boolean }) {
  const { busy, msg, run } = useAction();
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {shared ? (
          <Button variant="outline" disabled={busy} onClick={() => run("/api/gemini/mode", { mode: "shared_sandbox" })}>
            Use the shared sandbox account
          </Button>
        ) : null}
        <Button variant="outline" disabled={busy} onClick={() => run("/api/gemini/mode", { mode: "simulated" })}>
          Use simulated mode
        </Button>
      </div>
      {msg ? <p className={`text-sm ${msg.ok ? "text-positive" : "text-negative"}`}>{msg.text}</p> : null}
    </div>
  );
}

export function DisconnectButton() {
  const { busy, run } = useAction();
  return (
    <Button variant="ghost" size="sm" disabled={busy} onClick={() => run("/api/gemini/disconnect")}>
      Disconnect
    </Button>
  );
}
