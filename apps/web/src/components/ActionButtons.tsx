"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function ActionButtons() {
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const router = useRouter();
  const run = async (path: string, label: string) => {
    setBusy(label); setNote(null);
    const r = await fetch(path, { method: "POST" });
    const j = await r.json();
    setNote(r.ok ? (path.includes("discover") ? `${j.proposals.length} proposal(s), ${j.noTrades.length} no-trade decision(s)` : `${j.events.length} monitor event(s)`) : j.error);
    setBusy(null); router.refresh();
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button className="btn" disabled={!!busy} onClick={() => run("/api/discover", "discover")}>{busy === "discover" ? "Scanning…" : "Find opportunities"}</button>
      <button className="btn" disabled={!!busy} onClick={() => run("/api/monitor", "monitor")}>{busy === "monitor" ? "Checking…" : "Check positions"}</button>
      {note && <span className="text-xs text-muted">{note}</span>}
    </div>
  );
}
