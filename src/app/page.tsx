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
import MemoryPanel from "@/components/MemoryPanel";
import { DiscoverForm, Recommendations } from "@/components/Recommendations";
import RiskPanel from "@/components/RiskPanel";
import { post, type DashState, type ProposalView } from "@/components/state";
import { TickerStrip } from "@/components/TickerStrip";
import { TopBar } from "@/components/TopBar";
import { MotionConfig } from "motion/react";
import { HeroBackdrop, Reveal } from "@/components/fx";
import { Icon } from "@/components/icons";
import { TabBar } from "@/components/TabBar";
import { Logo, SectionHead } from "@/components/ui";

const TABS = [
  { key: "memory", label: "Memory", icon: "sparkle" },
  { key: "risk", label: "Risk", icon: "shield" },
  { key: "profile", label: "Limits", icon: "user" },
  { key: "connections", label: "Apps", icon: "plug" },
  { key: "receipts", label: "Receipts", icon: "receipt" },
  { key: "activity", label: "Activity", icon: "pulse" },
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
    <MotionConfig reducedMotion="user">
    <div className="relative isolate min-h-screen bg-bg pb-[env(safe-area-inset-bottom)]">
      <HeroBackdrop />
      <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur-xl backdrop-saturate-150">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <TopBar s={s} busy={busy} onTogglePause={() => run(() => post("/api/settings", { paused: !s.user.paused }))} />
        </div>
      </header>
      <TickerStrip s={s} />

      <main className="mx-auto max-w-6xl px-4 pb-16 pt-8 sm:px-6 sm:pt-10">
        {s.user.paused && (
          <div className="mb-6 flex items-center gap-2 rounded-full border border-warn/30 bg-warn-soft py-1.5 pl-3 pr-1.5 text-[13px] font-medium text-warn" title="No orders will be placed while paused">
            <Icon name="pause" className="h-3.5 w-3.5" />
            Trading paused
            <button onClick={() => run(() => post("/api/settings", { paused: false }), "Trading resumed.")} disabled={busy} className="ml-auto flex h-7 items-center gap-1 rounded-full bg-warn px-3 text-xs text-bg">
              <Icon name="play" className="h-3 w-3" />Resume
            </button>
          </div>
        )}

        <PortfolioHero s={s} />

        <Reveal className="mt-12">
        <section>
          <SectionHead
            title="Ideas"
            count={pending.length}
            action={<DiscoverForm onDiscover={discover} discovering={discovering} />}
          />
          <Recommendations
            proposals={s.proposals}
            onReject={(p: ProposalView) => run(() => post(`/api/proposals/${p.id}/reject`, { token: p.approvalToken }), "Idea rejected.")}
          />
        </section>
        </Reveal>

        <Reveal className="mt-12">
        <section>
          <SectionHead title="Positions" count={openPositions.length} />
          <Positions positions={s.positions} events={s.monitorEvents} onChanged={load} />
          {working.length > 0 && (
            <div className="mt-8">
              <h3 className="mb-3 flex items-center gap-2 text-[15px] font-semibold tracking-tight text-fg">
                <Icon name="clock" className="h-4 w-4 text-muted" />Orders <span className="num rounded-full bg-sunken px-2 py-0.5 text-xs font-medium text-muted">{working.length}</span>
              </h3>
              <OpenOrders orders={s.orders} onChanged={load} />
            </div>
          )}
        </section>
        </Reveal>

        <section className="mt-12">
          <TabBar tabs={TABS} value={tab} onChange={setTab} />
          <div role="tabpanel" className="animate-fade" key={tab}>
            {tab === "memory" && <MemoryPanel />}
            {tab === "risk" && <RiskPanel />}
            {tab === "profile" && (
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
            )}
            {tab === "connections" && <Connections />}
            {tab === "receipts" && <Receipts />}
            {tab === "activity" && <ActivityLog audit={s.audit} />}
          </div>
        </section>

        <div className="mt-14">
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
    </MotionConfig>
  );
}
