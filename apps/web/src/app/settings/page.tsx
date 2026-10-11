import { getContainer } from "@/lib/container";
import { getCurrentUser } from "@/lib/user";
import { SettingsForm } from "@/components/SettingsForm";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const c = getContainer();
  const user = await getCurrentUser();
  const theses = user ? await c.repo.listTheses(user.id) : [];
  const conn = user ? await c.repo.getExchangeConnection(user.id) : null;
  return (
    <div className="space-y-4">
      <h1 className="font-semibold text-lg">Settings</h1>
      <SettingsForm limits={user?.riskLimits ?? null} theses={theses.map((t) => ({ topic: t.topic, belief: t.belief, isInterest: t.isInterest }))} connection={conn ? { kind: conn.kind, roles: conn.roles, linkedAt: conn.linkedAt } : null} exchangeMode={c.status.exchange.mode} oauthAvailable={Boolean(process.env.GEMINI_OAUTH_CLIENT_ID)} />
      <div className="card text-sm space-y-1">
        <h2 className="font-semibold">Connected context (optional, future)</h2>
        <p className="text-muted">Gmail, Notion, Slack and Discord connectors are planned (P2). Nothing is connected; connected information would be context, never permission to trade.</p>
        <div className="flex gap-2">{["Gmail", "Notion", "Slack", "Discord"].map((n) => <span key={n} className="badge">{n}: not implemented</span>)}</div>
      </div>
    </div>
  );
}
