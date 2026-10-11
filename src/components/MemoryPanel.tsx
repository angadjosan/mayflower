"use client";
// What Mayflower remembers about you (GET /api/memories), with a per-item "forget" (DELETE /api/memories/:id).
import { useCallback, useEffect, useState } from "react";
import type { Memory } from "@/lib/types";
import { Feed } from "./Feed";
import { Icon, type IconName } from "./icons";
import { InfoTip, Ring, relTime } from "./ui";

const SOURCE: Record<string, string> = {
  chat: "chat", news_reply: "news reply", news_checkin: "news check-in", imessage_local: "your texts (Mac)",
  notion: "Notion", slack: "Slack", gmail: "Gmail", consolidation: "summary",
};
const KIND: Record<string, IconName> = { fact: "check", belief: "sparkle", preference: "target", event: "clock", summary: "layers" };

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
  const counts = rest.reduce<Record<string, number>>((acc, m) => ({ ...acc, [m.kind]: (acc[m.kind] ?? 0) + 1 }), {});

  if (error) return <div className="rounded-2xl border border-line bg-surface p-4 text-sm text-down">{error}</div>;
  if (!items) return <div className="h-24 animate-pulse rounded-2xl bg-sunken" />;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-4 shadow-card">
        <Ring value={Math.min(1, rest.length / 50)} size={48} stroke={4.5} color="var(--accent)" label={`${rest.length} memories`}>
          <span className="num text-[13px] font-semibold text-fg">{rest.length}</span>
        </Ring>
        <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
          {Object.entries(counts).map(([k, n]) => (
            <span key={k} className="inline-flex h-6 items-center gap-1 rounded-full bg-sunken px-2 text-xs text-fg-2">
              <Icon name={KIND[k] ?? "sparkle"} className="h-3 w-3" />{k} <span className="num text-muted">{n}</span>
            </span>
          ))}
          {!rest.length && <span className="text-sm text-muted">Nothing yet</span>}
        </div>
        {summary && <InfoTip title="Summary"><p>{summary.text}</p></InfoTip>}
      </div>

      {rest.length > 0 && (
        <Feed
          items={rest.map((m) => ({ id: m.id, title: m.text }))}
          renderItem={(_, i) => {
            const m = rest[i];
            return (
              <div className="flex w-full min-w-0 items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sunken text-fg-2" title={m.kind}>
                  <Icon name={KIND[m.kind] ?? "sparkle"} className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-[13.5px] leading-snug text-fg">{m.text}</span>
                  <span className="mt-0.5 block text-[11px] text-muted">{SOURCE[m.source] ?? m.source} · {relTime(m.updatedAt)}</span>
                </span>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); void forget(m.id); }}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-down-soft hover:text-down"
                  aria-label={`Forget: ${m.text}`}
                  title="Forget"
                >
                  <Icon name="x" className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          }}
        />
      )}
    </div>
  );
}
