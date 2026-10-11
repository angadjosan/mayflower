"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input } from "@/components/ui/primitives";

export function DemoMarketMove({ positions }: { positions: { symbol: string; label: string }[] }) {
  const router = useRouter();
  const [symbol, setSymbol] = useState(positions[0]?.symbol ?? "");
  const [delta, setDelta] = useState(-0.12);
  const [headline, setHeadline] = useState("Key player ruled out with an injury");
  const [msg, setMsg] = useState<string | null>(null);
  if (positions.length === 0) return <p className="text-muted">Open a (simulated) position first.</p>;
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const res = await fetch("/api/dev/market-move", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ symbol, delta, headline }) });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setMsg(res.ok ? "Moved. Now press “Check positions now” on the dashboard." : (data.error ?? "Failed"));
        router.refresh();
      }}
    >
      <select className="h-10 rounded-lg border border-border bg-surface px-3" value={symbol} onChange={(e) => setSymbol(e.target.value)}>
        {positions.map((p) => (
          <option key={p.symbol} value={p.symbol}>
            {p.label}
          </option>
        ))}
      </select>
      <div className="flex gap-2">
        <Input type="number" step="0.01" min={-0.5} max={0.5} value={delta} onChange={(e) => setDelta(Number(e.target.value))} className="w-28" />
        <Input value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="Simulated headline" />
      </div>
      <Button type="submit" variant="outline">
        Simulate market move + news
      </Button>
      {msg ? <p className="text-xs text-muted">{msg}</p> : null}
    </form>
  );
}
