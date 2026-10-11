"use client";
// What Mayflower remembers about you (GET /api/memories), with a per-item "forget" (DELETE /api/memories/:id).
// Self-contained on purpose (no shared ui imports) so it can be dropped anywhere in the dashboard.
import { useCallback, useEffect, useState } from "react";
import type { Memory } from "@/lib/types";

const SOURCE: Record<string, string> = {
  chat: "chat", news_reply: "news reply", news_checkin: "news check-in", imessage_local: "your texts (Mac)",
  notion: "Notion", slack: "Slack", gmail: "Gmail", consolidation: "summary",
};

export default function MemoryPanel() {
  const [items, setItems] = useState<Memory[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/memories", { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      setItems(((await r.json()) as { memories: Memory[] }).memories);
    } catch {
      setError("Couldn't load memories.");
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const forget = async (id: string) => {
    setItems((xs) => xs?.filter((m) => m.id !== id) ?? null);
    await fetch(`/api/memories/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => undefined);
  };

  const summary = items?.find((m) => m.kind === "summary");
  const rest = items?.filter((m) => m.kind !== "summary") ?? [];
  return (
    <section className="rounded-xl border border-black/10 p-4 dark:border-white/10">
      <h3 className="text-sm font-semibold">What Mayflower remembers</h3>
      {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
      {!items && !error && <p className="mt-2 text-xs opacity-60">Loading…</p>}
      {summary && <p className="mt-2 text-xs opacity-80">{summary.text}</p>}
      {items && !rest.length && <p className="mt-2 text-xs opacity-60">Nothing yet. Text Mayflower your takes, or forward a screenshot.</p>}
      <ul className="mt-3 space-y-2">
        {rest.map((m) => (
          <li key={m.id} className="flex items-start justify-between gap-3 text-sm">
            <div className="min-w-0">
              <div className="break-words">{m.text}</div>
              <div className="text-[11px] opacity-60">{m.kind} · {SOURCE[m.source] ?? m.source} · {m.updatedAt.slice(0, 10)}</div>
            </div>
            <button type="button" onClick={() => void forget(m.id)} className="shrink-0 text-xs opacity-60 hover:opacity-100" aria-label={`Forget: ${m.text}`}>
              forget
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
