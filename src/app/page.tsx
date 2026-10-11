"use client";
import { useCallback, useEffect, useState } from "react";
import type { RiskLimits } from "@/lib/types";
import Connections from "@/components/Connections";
import { ActivityLog, Footer } from "@/components/Footer";
import { OpenOrders, workingOrders } from "@/components/OpenOrders";
import { PortfolioHero } from "@/components/PortfolioHero";
import { Positions } from "@/components/Positions";
import { Profile } from "@/components/Profile";
import Receipts from "@/components/Receipts";
import { DiscoverForm, Recommendations } from "@/components/Recommendations";
import RiskPanel from "@/components/RiskPanel";
import { post, type DashState, type ProposalView } from "@/components/state";
import { TickerStrip } from "@/components/TickerStrip";
import { TopBar } from "@/components/TopBar";
import { Card, Logo, SectionHead } from "@/components/ui";

const TABS = [
  { key: "risk", label: "Risk" },
  { key: "profile", label: "Profile & limits" },
  { key: "connections", label: "Connections" },
  { key: "receipts", label: "Receipts" },
  { key: "activity", label: "Activity" },
] as const;
type Tab = (typeof TABS)[number]["key"];

export default function Dashboard() {
  const [s, setS] = useState<DashState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [tab, setTab] = useState<Tab>("risk");

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

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

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

  const discover = async (focus?: string) => {
    setDiscovering(true);
    try {
      const r = await post<{ proposals?: unknown[] }>("/api/discover", focus ? { focus } : {});
      setNotice(r.proposals?.length ? `Found ${r.proposals.length} idea${r.proposals.length === 1 ? "" : "s"}.` : "No trades worth making right now.");
      await load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Discovery failed");
    } finally {
      setDiscovering(false);
    }
  };

  if (!s) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg p-6">
        <div className="flex flex-col items-center text-center">
          <Logo size={44} className="animate-pulse" />
          <p className="mt-4 text-sm text-muted">{error ? `${error}. Retrying…` : "Loading your portfolio…"}</p>
        </div>
      </main>
    );
  }

  const pending = s.proposals.filter((p) => p.status === "pending");
  const openPositions = s.positions.filter((p) => p.status === "open");
  const working = workingOrders(s.orders);

  return (
    <div className="min-h-screen bg-bg pb-[env(safe-area-inset-bottom)]">
      <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur-xl backdrop-saturate-150">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <TopBar s={s} busy={busy} onTogglePause={() => run(() => post("/api/settings", { paused: !s.user.paused }))} />
        </div>
      </header>
      <TickerStrip s={s} />

      <main className="mx-auto max-w-6xl px-4 pb-16 pt-8 sm:px-6 sm:pt-10">
        {s.user.paused && (
          <div className="mb-6 flex items-center justify-between gap-3 rounded-xl border border-warn/30 bg-warn-soft px-4 py-3 text-[13px] text-warn">
            <span>Trading is paused. Mayflower won&apos;t place any orders until you turn it back on.</span>
            <button onClick={() => run(() => post("/api/settings", { paused: false }), "Trading resumed.")} disabled={busy} className="shrink-0 font-medium underline underline-offset-2">
              Resume
            </button>
          </div>
        )}

        <PortfolioHero s={s} />

        <section className="mt-16">
          <SectionHead
            title="Ideas"
            count={pending.length}
            sub="Trades Mayflower is proposing. Nothing executes until you approve it."
            action={<DiscoverForm onDiscover={discover} discovering={discovering} />}
          />
          <Recommendations
            proposals={s.proposals}
            onReject={(p: ProposalView) => run(() => post(`/api/proposals/${p.id}/reject`, { token: p.approvalToken }), "Idea rejected.")}
          />
        </section>

        <section className="mt-16">
          <SectionHead title="Positions" count={openPositions.length} sub="Tap a row for the thesis, evidence and exit options." />
          <Positions positions={s.positions} events={s.monitorEvents} onChanged={load} />
          {working.length > 0 && (
            <div className="mt-8">
              <h3 className="mb-3 flex items-center gap-2 text-[15px] font-semibold tracking-tight text-fg">
                Open orders <span className="num rounded-full bg-sunken px-2 py-0.5 text-xs font-medium text-muted">{working.length}</span>
              </h3>
              <OpenOrders orders={s.orders} onChanged={load} />
            </div>
          )}
        </section>

        <section className="mt-16">
          <div className="no-scrollbar -mx-4 mb-5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <div className="flex min-w-max gap-6 border-b border-line" role="tablist">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={tab === t.key}
                  onClick={() => setTab(t.key)}
                  className={`-mb-px border-b-2 pb-3 text-sm transition-colors ${tab === t.key ? "border-fg font-medium text-fg" : "border-transparent text-muted hover:text-fg"}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div role="tabpanel" className="animate-fade" key={tab}>
            {tab === "risk" && <RiskPanel />}
            {tab === "profile" && (
              <Card>
                <Profile
                  user={s.user}
                  theses={s.theses}
                  busy={busy}
                  onSave={(body: { limits: Partial<RiskLimits>; name?: string; handle?: string }) => run(() => post("/api/settings", body), "Settings saved.")}
                  onLinkGemini={() =>
                    run(async () => {
                      // OAuth configured → go to Gemini; otherwise the shared sandbox account is linked.
                      const j = await post<{ redirect?: string }>("/api/link-gemini");
                      if (j.redirect) window.location.href = j.redirect;
                    }, "Gemini linked.")
                  }
                />
              </Card>
            )}
            {tab === "connections" && <Connections />}
            {tab === "receipts" && <Receipts />}
            {tab === "activity" && <Card><ActivityLog audit={s.audit} /></Card>}
          </div>
        </section>

        <div className="mt-20">
          <Footer
            busy={busy}
            onMonitor={() => run(() => post("/api/cron/monitor"), "Monitor ran.")}
            onReset={() => run(() => post("/api/reset"), "Demo reset.")}
          />
        </div>
      </main>

      {(notice || error) && (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4 pb-[env(safe-area-inset-bottom)]">
          <div className="animate-rise pointer-events-auto flex max-w-md items-center gap-3 rounded-full bg-ink px-4 py-2.5 text-[13px] text-ink-fg shadow-[0_12px_32px_-12px_rgba(0,0,0,0.5)]">
            <span>{error ? `${error}. Showing last known data.` : notice}</span>
            {notice && !error && (
              <button onClick={() => setNotice(null)} className="opacity-60 hover:opacity-100" aria-label="Dismiss">
                <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" stroke="currentColor" strokeWidth={1.6} aria-hidden><path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" /></svg>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
