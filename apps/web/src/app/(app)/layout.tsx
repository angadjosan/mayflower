import Link from "next/link";
import { requireUser } from "@/server/session";
import { featureStatuses } from "@/server/status";
import { FeatureBadge } from "@/components/feature-badge";
import { NavLinks } from "@/components/nav-links";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const statuses = await featureStatuses();
  const pick = (k: string) => statuses.find((s) => s.key === k)!;
  const chips = [pick("market_data"), pick("execution"), pick("research"), pick("llm"), pick("imessage")];
  const killed = pick("kill_switch").label === "offline";
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-border bg-surface/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
          <Link href="/dashboard" className="font-semibold">
            Mayflower
          </Link>
          <NavLinks />
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-sm text-muted sm:inline">{user.displayName ?? user.imessageHandle}</span>
            <form action="/auth/logout" method="post">
              <button className="text-sm text-muted hover:text-text">Sign out</button>
            </form>
          </div>
        </div>
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 pb-3 text-xs">
          {chips.map((s) => (
            <Link key={s.key} href="/status" title={s.detail} className="inline-flex items-center gap-1.5 text-muted hover:text-text">
              {s.name.replace(" (BlueBubbles)", "").replace("Google Gemini reasoning", "AI reasoning").replace("Gemini prediction markets", "Markets")}:
              <FeatureBadge label={s.label} />
            </Link>
          ))}
        </div>
      </header>
      {killed ? (
        <div className="bg-negative-bg px-4 py-2 text-center text-sm text-negative">The global kill switch is on — no orders will be submitted.</div>
      ) : null}
      {user.tradingPaused ? (
        <div className="bg-warning-bg px-4 py-2 text-center text-sm text-warning">Your trading is paused. Mayflower keeps monitoring but won't submit orders.</div>
      ) : null}
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
