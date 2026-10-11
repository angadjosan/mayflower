"use client";
import type { DashState } from "./state";
import { Badge, Button, Stat, pnlClass, signedUsd, usd } from "./ui";

const DEMO_USER_ID = "user_demo";

function Account({ s }: { s: DashState }) {
  if (s.user.id === DEMO_USER_ID) {
    return (
      <span className="text-xs text-stone-500">
        Demo user ·{" "}
        <a href="/login" className="text-indigo-600 hover:underline">Sign in</a>
      </span>
    );
  }
  const signOut = async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.reload();
  };
  return (
    <span className="text-xs text-stone-500">
      Signed in as <span className="font-medium text-stone-700">{s.user.name || s.user.handle || s.user.id}</span> ·{" "}
      <button onClick={signOut} className="text-indigo-600 hover:underline">Sign out</button>
    </span>
  );
}

export function Header({ s, onTogglePause, busy }: { s: DashState; onTogglePause: () => void; busy: boolean }) {
  const p = s.portfolio;
  const pnl = p.unrealizedPnlUsd + p.realizedPnlUsd;
  const riskPct = p.riskBudgetUsd > 0 ? Math.min(100, (p.atRiskUsd / p.riskBudgetUsd) * 100) : 0;
  return (
    <header className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600 text-sm font-bold text-white">M</div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Mayflower</h1>
            <p className="text-xs text-stone-500">{s.user.name ? `Hi, ${s.user.name}` : "Your prediction-market copilot"}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Account s={s} />
          {s.user.paused && <Badge tone="warn">Paused: no orders will be placed</Badge>}
          <Button variant={s.user.paused ? "primary" : "danger"} onClick={onTogglePause} disabled={busy}>
            {s.user.paused ? "Resume trading" : "Pause all trading"}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Badge tone={s.modes.llm ? "good" : "warn"}>LLM {s.modes.llm ? "on" : "off (rule-based)"}</Badge>
        <Badge tone={s.modes.exchange === "sandbox" ? "accent" : "warn"}>
          Exchange: {s.modes.exchange === "sandbox" ? "Gemini sandbox" : "simulated"}
        </Badge>
        <Badge tone={s.modes.research === "context.dev" ? "good" : "warn"}>
          Research: {s.modes.research === "context.dev" ? "Context.dev" : "mock"}
        </Badge>
        <Badge tone={s.modes.imessage ? "good" : "neutral"}>{s.modes.imessage ? "iMessage connected" : "iMessage off: web fallback"}</Badge>
        {s.user.geminiLinked && <Badge tone="accent">Sandbox: shared account</Badge>}
      </div>

      <div className="grid grid-cols-2 gap-4 rounded-2xl border border-stone-200 bg-white p-5 sm:grid-cols-4">
        <Stat label="Portfolio value" value={usd(p.valueUsd)} />
        <Stat label="Budget remaining" value={usd(p.availableUsd)} />
        <Stat label="P&L" value={signedUsd(pnl)} className={pnlClass(pnl)} />
        <div>
          <div className="text-xs text-stone-500">At risk / risk budget</div>
          <div className="mt-0.5 text-lg font-semibold tabular-nums tracking-tight">
            {usd(p.atRiskUsd, 0)} <span className="text-sm font-normal text-stone-400">/ {usd(p.riskBudgetUsd, 0)}</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-stone-100">
            <div className={`h-full rounded-full ${riskPct > 85 ? "bg-rose-500" : "bg-indigo-500"}`} style={{ width: `${riskPct}%` }} />
          </div>
        </div>
      </div>
    </header>
  );
}
