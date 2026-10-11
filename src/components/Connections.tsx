"use client";
import { useCallback, useEffect, useState } from "react";
import type { ConnectedSource, ContextItem, UserThesis } from "@/lib/types";
import { Badge, Button, Card, time } from "./ui";

type Provider = "notion" | "slack" | "gmail";
type Source = Omit<ConnectedSource, "tokenEnc"> & { theses: UserThesis[]; contextItems: ContextItem[] };
type Data = { sources: Source[]; available: Record<Provider, boolean> };

const PROVIDERS: { id: Provider; label: string; blurb: string }[] = [
  { id: "notion", label: "Notion", blurb: "Recently edited pages you share with Mayflower" },
  { id: "slack", label: "Slack", blurb: "Your own recent messages" },
  { id: "gmail", label: "Gmail", blurb: "Subjects and previews of recent newsletters and mail" },
];

export default function Connections() {
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/connect", { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData((await r.json()) as Data);
    } catch {
      setError("Couldn't load connections.");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const sync = async (p: Provider) => {
    setBusy(p); setError(null);
    try {
      const r = await fetch(`/api/connect/${p}/sync`, { method: "POST" });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) setError(j.error || "Sync failed.");
    } finally {
      await refresh();
      setBusy(null);
    }
  };

  const disconnect = async (p: Provider, s: Source) => {
    if (!confirm(`Disconnect ${label(p)}? Mayflower will delete the token and everything it learned from it.`)) return;
    setBusy(p); setError(null);
    try {
      await fetch(`/api/connect/source/${s.id}`, { method: "DELETE" });
    } finally {
      await refresh();
      setBusy(null);
    }
  };

  return (
    <Card title="Connected context">
      <p className="mb-3 text-xs text-stone-500">Optional. Used only as context for ideas — never as permission to trade.</p>
      {error && <p className="mb-2 text-xs text-rose-600">{error}</p>}
      {!data ? (
        <p className="text-sm text-stone-400">Loading…</p>
      ) : (
        <ul className="divide-y divide-stone-100">
          {PROVIDERS.map((p) => {
            const s = data.sources.find((x) => x.provider === p.id);
            const configured = data.available[p.id];
            const learned = s ? s.theses.length + s.contextItems.length : 0;
            return (
              <li key={p.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-stone-900">{p.label}</span>
                      {s ? (
                        s.status === "error" ? <Badge tone="warn">Error</Badge> : <Badge tone="good">Connected</Badge>
                      ) : !configured ? (
                        <Badge>Not configured</Badge>
                      ) : null}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-stone-500">
                      {s
                        ? [s.accountLabel, s.lastSyncedAt ? `synced ${time(s.lastSyncedAt)}` : "not synced yet"].filter(Boolean).join(" · ")
                        : p.blurb}
                    </div>
                    {s?.lastError && <div className="mt-0.5 text-xs text-rose-600">{s.lastError}</div>}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {s ? (
                      <>
                        <Button onClick={() => sync(p.id)} disabled={busy === p.id}>{busy === p.id ? "Syncing…" : "Sync now"}</Button>
                        <Button variant="danger" onClick={() => disconnect(p.id, s)} disabled={busy === p.id}>Disconnect</Button>
                      </>
                    ) : (
                      <a
                        href={configured ? `/api/connect/${p.id}/start` : undefined}
                        aria-disabled={!configured}
                        className={`inline-flex items-center rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
                          configured ? "border-stone-200 bg-white text-stone-700 hover:bg-stone-50" : "pointer-events-none border-stone-200 bg-white text-stone-400 opacity-50"
                        }`}
                      >
                        Connect
                      </a>
                    )}
                  </div>
                </div>

                {s && (
                  <div className="mt-2">
                    <button
                      type="button"
                      onClick={() => setOpen((o) => ({ ...o, [p.id]: !o[p.id] }))}
                      className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
                    >
                      {open[p.id] ? "▾" : "▸"} What Mayflower learned ({learned})
                    </button>
                    {open[p.id] && (
                      <div className="mt-2 space-y-2 rounded-xl bg-stone-50 p-3">
                        {learned === 0 ? (
                          <p className="text-xs text-stone-400">Nothing yet. Try Sync now.</p>
                        ) : (
                          <>
                            {s.theses.length > 0 && (
                              <ul className="space-y-1">
                                {s.theses.map((t) => (
                                  <li key={t.id} className="text-sm">
                                    <span className="font-medium">{t.topic}</span>
                                    {t.belief && <span className="text-stone-600">: {t.belief}</span>}{" "}
                                    <span className="text-xs text-stone-400">({Math.round(t.confidence * 100)}%)</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                            {s.contextItems.length > 0 && (
                              <ul className="space-y-1.5 border-t border-stone-200 pt-2">
                                {s.contextItems.map((c) => (
                                  <li key={c.id} className="text-xs text-stone-600">
                                    <div className="font-medium text-stone-700">
                                      {c.url ? (
                                        <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-indigo-600 underline decoration-indigo-200 underline-offset-2 hover:decoration-indigo-600">
                                          {c.title}
                                        </a>
                                      ) : (
                                        c.title
                                      )}
                                    </div>
                                    <div className="italic">“{c.excerpt}”</div>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

const label = (p: Provider) => PROVIDERS.find((x) => x.id === p)?.label ?? p;
