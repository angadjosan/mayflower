"use client";
import { useCallback, useEffect, useState } from "react";
import type { ChatMessage, RiskLimits } from "@/lib/types";
import { Chat } from "@/components/Chat";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { Performance } from "@/components/Performance";
import { Positions } from "@/components/Positions";
import { Profile } from "@/components/Profile";
import { Recommendations } from "@/components/Recommendations";
import { post, type DashState, type ProposalView } from "@/components/state";

export default function Dashboard() {
  const [s, setS] = useState<DashState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [sending, setSending] = useState(false);
  const [pendingMsg, setPendingMsg] = useState<ChatMessage | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/state", { cache: "no-store" });
      if (res.status === 401) {
        window.location.href = "/login?next=/";
        return;
      }
      if (!res.ok) throw new Error(`Could not load state (${res.status})`);
      setS(await res.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load state");
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try {
      await fn();
      if (ok) setNotice(ok);
      await load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const send = async (text: string) => {
    setSending(true);
    setPendingMsg({ id: "pending", userId: "", role: "user", text, channel: "web", createdAt: new Date().toISOString() });
    try {
      await post("/api/chat", { text });
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Chat failed");
    } finally {
      await load();
      setPendingMsg(null);
      setSending(false);
    }
  };

  const discover = async (focus?: string) => {
    setDiscovering(true);
    try {
      const r = await post<{ proposals?: unknown[] }>("/api/discover", focus ? { focus } : {});
      setNotice(r.proposals?.length ? `Found ${r.proposals.length} idea(s).` : "No trades worth making right now.");
      await load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Discovery failed");
    } finally {
      setDiscovering(false);
    }
  };

  if (!s) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="text-center">
          <div className="text-lg font-semibold">Mayflower</div>
          <p className="mt-1 text-sm text-stone-500">{error ? `${error}. Retrying…` : "Loading…"}</p>
        </div>
      </main>
    );
  }

  const messages = pendingMsg ? [...s.messages, pendingMsg] : s.messages;

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6">
          <Header s={s} busy={busy} onTogglePause={() => run(() => post("/api/settings", { paused: !s.user.paused }))} />

          {(error || notice) && (
            <div className="flex items-start justify-between gap-3 rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
              <span>{error ? `${error}. Showing last known data.` : notice}</span>
              {notice && !error && (
                <button onClick={() => setNotice(null)} className="text-amber-600 hover:text-amber-900" aria-label="Dismiss">×</button>
              )}
            </div>
          )}

          <Recommendations
            proposals={s.proposals}
            discovering={discovering}
            onDiscover={discover}
            onAsk={(p: ProposalView) => send(`Why ${p.market.title}?`)}
            onReject={(p: ProposalView) =>
              run(() => post(`/api/proposals/${p.id}/reject`, { token: p.approvalToken }), "Recommendation rejected.")
            }
          />

          <Positions positions={s.positions} events={s.monitorEvents} />

          <div className="grid gap-6 md:grid-cols-2">
            <Performance p={s.portfolio} />
            <Profile
              user={s.user}
              theses={s.theses}
              busy={busy}
              onSave={(body: { limits: Partial<RiskLimits>; name?: string; handle?: string }) => run(() => post("/api/settings", body), "Settings saved.")}
              onLinkGemini={() => run(() => post("/api/link-gemini"), "Gemini sandbox linked (shared account).")}
            />
          </div>
        </div>

        <aside className="lg:sticky lg:top-6 lg:self-start">
          <Chat messages={messages} onSend={send} sending={sending} />
        </aside>
      </div>

      <div className="mt-8">
        <Footer
          audit={s.audit}
          busy={busy}
          onMonitor={() => run(() => post("/api/cron/monitor"), "Monitor ran.")}
          onReset={() => run(() => post("/api/reset"), "Demo reset.")}
        />
      </div>
    </main>
  );
}
