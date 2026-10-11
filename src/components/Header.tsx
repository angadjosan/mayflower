"use client";
import type { DashState } from "./state";
import { Badge, Logo, Toggle, signedUsd, usd } from "./ui";

const DEMO_USER_ID = "user_demo";

function Account({ s }: { s: DashState }) {
  if (s.user.id === DEMO_USER_ID) {
    return (
      <span className="text-xs text-stone-500">
        Demo user ·{" "}
        <a href="/login" className="font-semibold text-imsg hover:underline">Sign in</a>
      </span>
    );
  }
  const signOut = async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.reload();
  };
  return (
    <span className="text-xs text-stone-500">
      <span className="font-semibold text-stone-700">{s.user.name || s.user.handle || s.user.id}</span> ·{" "}
      <button onClick={signOut} className="font-semibold text-imsg hover:underline">Sign out</button>
    </span>
  );
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export function Header({ s, onTogglePause, busy }: { s: DashState; onTogglePause: () => void; busy: boolean }) {
  const p = s.portfolio;
  const pnl = p.unrealizedPnlUsd + p.realizedPnlUsd;
  const riskPct = p.riskBudgetUsd > 0 ? Math.min(100, (p.atRiskUsd / p.riskBudgetUsd) * 100) : 0;
  const [dollars, centsPart] = usd(p.valueUsd).split(".");
  return (
    <header className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Logo size={40} />
          <div>
            <h1 className="text-xl font-bold tracking-tight">Mayflower</h1>
            <p className="text-xs text-stone-500">{s.user.name ? `${greeting()}, ${s.user.name} 👋` : "Your prediction-market copilot"}</p>
          </div>
        </div>
        <Account s={s} />
      </div>

      <div className="animate-rise relative overflow-hidden rounded-[28px] bg-gradient-to-br from-money-500 via-money-600 to-money-800 p-6 text-white shadow-[0_20px_40px_-20px_rgba(0,138,51,0.7)]">
        <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-white/10 blur-2xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-24 left-10 h-48 w-48 rounded-full bg-money-300/20 blur-2xl" aria-hidden />

        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-sm font-medium text-white/75">Portfolio value</div>
            <div className="mt-1 flex items-baseline font-bold tracking-tight tabular-nums">
              <span className="text-5xl sm:text-6xl">{dollars}</span>
              {centsPart && <span className="text-2xl text-white/70">.{centsPart}</span>}
            </div>
            <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-white/20 px-2.5 py-1 text-sm font-semibold backdrop-blur">
              <span aria-hidden>{pnl > 0 ? "▲" : pnl < 0 ? "▼" : "•"}</span>
              {signedUsd(pnl)} all time
            </div>
          </div>

          <label className="flex cursor-pointer items-center gap-3 rounded-2xl bg-black/15 px-3.5 py-2.5 backdrop-blur">
            <div className="text-right">
              <div className="text-sm font-semibold">{s.user.paused ? "Trading paused" : "Trading on"}</div>
              <div className="text-[11px] text-white/70">{s.user.paused ? "No orders will be placed" : "You approve every trade"}</div>
            </div>
            <Toggle on={!s.user.paused} onChange={onTogglePause} disabled={busy} label="Allow trading" />
          </label>
        </div>

        <div className="relative mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Tile label="Budget left" value={usd(p.availableUsd)} />
          <Tile label="Unrealized" value={signedUsd(p.unrealizedPnlUsd)} />
          <div className="col-span-2 rounded-2xl bg-white/15 px-4 py-3 backdrop-blur sm:col-span-1">
            <div className="flex items-baseline justify-between text-xs text-white/75">
              <span>At risk</span>
              <span className="tabular-nums">{Math.round(riskPct)}% of budget</span>
            </div>
            <div className="mt-0.5 text-lg font-bold tabular-nums">
              {usd(p.atRiskUsd, 0)} <span className="text-sm font-medium text-white/60">/ {usd(p.riskBudgetUsd, 0)}</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/25">
              <div
                className={`h-full rounded-full transition-[width] duration-700 ${riskPct > 85 ? "bg-rose-300" : "bg-white"}`}
                style={{ width: `${riskPct}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Badge tone={s.modes.imessage ? "accent" : "neutral"}>{s.modes.imessage ? "💬 iMessage connected" : "💬 iMessage off: web chat"}</Badge>
        <Badge tone={s.modes.llm ? "good" : "warn"}>🧠 LLM {s.modes.llm ? "on" : "off (rule-based)"}</Badge>
        <Badge tone={s.modes.exchange === "sandbox" ? "good" : "warn"}>
          🏦 {s.modes.exchange === "sandbox" ? "Gemini sandbox" : "Simulated exchange"}
        </Badge>
        {s.modes.polymarket && s.modes.polymarket !== "off" && (
          <Badge tone={s.modes.polymarket === "live" ? "good" : "warn"}>
            Polymarket {s.modes.polymarket === "live" ? "live" : "simulated"}
          </Badge>
        )}
        {s.modes.hyperliquid && s.modes.hyperliquid !== "off" && (
          <Badge tone={s.modes.hyperliquid === "simulated" ? "warn" : "good"}>Hyperliquid {s.modes.hyperliquid}</Badge>
        )}
        <Badge tone={s.modes.research === "context.dev" ? "good" : "warn"}>
          🔎 Research: {s.modes.research === "context.dev" ? "Context.dev" : "mock"}
        </Badge>
        {s.user.geminiLinked && <Badge tone="neutral">Sandbox: shared account</Badge>}
      </div>
    </header>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white/15 px-4 py-3 backdrop-blur">
      <div className="text-xs text-white/75">{label}</div>
      <div className="mt-0.5 text-lg font-bold tabular-nums">{value}</div>
    </div>
  );
}
