"use client";
import { useCallback, useEffect, useState } from "react";
import type { ConnectedSource, ContextItem, UserThesis } from "@/lib/types";
import { Icon } from "./icons";
import { Chip, IconButton, Sheet, time } from "./ui";

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
    <div className="space-y-3">
      {error && <p className="text-xs text-down">{error}</p>}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {PROVIDERS.map((p) => {
          const s = data?.sources.find((x) => x.provider === p.id);
          const configured = data?.available[p.id] ?? false;
          const learned = s ? s.theses.length + s.contextItems.length : 0;
          const on = !!s && s.status !== "error";
          const tile = "relative flex flex-col items-center gap-2 rounded-2xl border bg-surface p-4 text-center shadow-card transition-colors";
          return (
            <div key={p.id} className={`${tile} ${on ? "border-accent/40" : "border-line"} ${!data ? "animate-pulse" : ""}`}>
              <span className={`absolute right-3 top-3 h-2 w-2 rounded-full ${s ? (s.status === "error" ? "bg-down" : "bg-up") : "bg-line-strong"}`} aria-label={s ? s.status : "off"} />
              <BrandMark id={p.id} dim={!s} />
              <div className="text-[13px] font-medium text-fg">{p.label}</div>
              {s ? (
                <div className="flex items-center gap-0.5">
                  <IconButton label="What Mayflower learned" className="h-7 w-auto gap-1 px-2 text-[11px]" onClick={() => setOpen((o) => ({ ...o, [p.id]: true }))}>
                    <Icon name="sparkle" className="h-3 w-3" /><span className="num">{learned}</span>
                  </IconButton>
                  <IconButton label="Sync now" className="h-7 w-7" onClick={() => sync(p.id)} disabled={busy === p.id}>
                    <Icon name="refresh" className={`h-3.5 w-3.5 ${busy === p.id ? "animate-spin" : ""}`} />
                  </IconButton>
                  <IconButton label="Disconnect" className="h-7 w-7 hover:text-down" onClick={() => disconnect(p.id, s)} disabled={busy === p.id}>
                    <Icon name="x" className="h-3.5 w-3.5" />
                  </IconButton>
                </div>
              ) : (
                <a
                  href={configured ? `/api/connect/${p.id}/start` : undefined}
                  aria-disabled={!configured}
                  title={configured ? `Connect ${p.label}` : "Not configured on this server"}
                  className={`inline-flex h-7 items-center gap-1 rounded-full px-3 text-[11px] font-medium transition-opacity ${configured ? "bg-ink text-ink-fg hover:opacity-90" : "pointer-events-none bg-sunken text-subtle"}`}
                >
                  {configured ? <><Icon name="plus" className="h-3 w-3" />Connect</> : "Off"}
                </a>
              )}
              {s && (
                <Sheet open={!!open[p.id]} onClose={() => setOpen((o) => ({ ...o, [p.id]: false }))} title={<span className="flex items-center gap-2"><BrandMark id={p.id} size={24} />{p.label}</span>}>
                  <div className="space-y-4 text-left">
                    <div className="flex flex-wrap gap-1.5">
                      {s.accountLabel && <Chip>{s.accountLabel}</Chip>}
                      <Chip><Icon name="clock" className="h-3 w-3" />{s.lastSyncedAt ? time(s.lastSyncedAt) : "never"}</Chip>
                    </div>
                    {s.lastError && <p className="text-xs text-down">{s.lastError}</p>}
                    {learned === 0 && <p className="text-sm text-subtle">Nothing yet</p>}
                    {s.theses.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {s.theses.map((t) => <Chip key={t.id} tone="accent" title={t.belief}>{t.topic} · {Math.round(t.confidence * 100)}%</Chip>)}
                      </div>
                    )}
                    {s.contextItems.length > 0 && (
                      <ul className="space-y-2 border-t border-line pt-3">
                        {s.contextItems.map((c) => (
                          <li key={c.id} className="text-xs text-muted">
                            <div className="font-medium text-fg-2">
                              {c.url ? <a href={c.url} target="_blank" rel="noopener noreferrer" className="hover:text-accent">{c.title}</a> : c.title}
                            </div>
                            <div className="mt-0.5 line-clamp-2">{c.excerpt}</div>
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="text-[11px] text-subtle">{p.blurb}. Context only, never permission to trade.</p>
                  </div>
                </Sheet>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Simple hand-drawn marks (not official logos) so each tile is recognisable at a glance. */
function BrandMark({ id, size = 36, dim = false }: { id: Provider; size?: number; dim?: boolean }) {
  const common = { width: size, height: size, viewBox: "0 0 32 32", "aria-hidden": true, className: `shrink-0 transition-opacity ${dim ? "opacity-70" : ""}` } as const;
  if (id === "notion")
    return (
      <svg {...common}>
        <rect x="3" y="3" width="26" height="26" rx="6" fill="var(--fg)" />
        <path d="M11 22V10l10 12V10" fill="none" stroke="var(--bg)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  if (id === "slack")
    return (
      <svg {...common}>
        <rect x="3" y="3" width="26" height="26" rx="6" fill="var(--sunken)" />
        <path d="M13 8v10" stroke="#36c5f0" strokeWidth="3" strokeLinecap="round" />
        <path d="M19 14v10" stroke="#2eb67d" strokeWidth="3" strokeLinecap="round" />
        <path d="M8 19h10" stroke="#e01e5a" strokeWidth="3" strokeLinecap="round" />
        <path d="M14 13h10" stroke="#ecb22e" strokeWidth="3" strokeLinecap="round" />
      </svg>
    );
  return (
    <svg {...common}>
      <rect x="3" y="3" width="26" height="26" rx="6" fill="var(--sunken)" />
      <path d="M8 11.5v10h3.5v-6.5L16 18.5l4.5-3.5v6.5H24v-10l-8 6-8-6Z" fill="#ea4335" />
    </svg>
  );
}

const label = (p: Provider) => PROVIDERS.find((x) => x.id === p)?.label ?? p;
