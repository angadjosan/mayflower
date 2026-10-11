import Link from "next/link";
import { requireUser } from "@/server/session";
import { activeTheses, effectiveLimits } from "@/server/users";
import { activeConnection, defaultMode, modeLabel } from "@/server/gemini-link";
import { Badge, Card, CardBody, CardHeader, CardTitle } from "@/components/ui/primitives";
import { AddBelief, ProfileForm, RemoveBelief } from "@/components/profile-forms";
import { PauseToggle } from "@/components/actions";
import { FeatureBadge } from "@/components/feature-badge";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const user = await requireUser();
  const theses = await activeTheses(user.id);
  const limits = effectiveLimits(user);
  const conn = await activeConnection(user.id);
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <h1 className="text-2xl font-semibold">Profile</h1>
      <Card>
        <CardHeader>
          <CardTitle>Interests & risk limits</CardTitle>
        </CardHeader>
        <CardBody>
          <ProfileForm
            initial={{
              displayName: user.displayName ?? "",
              riskBudget: limits.riskBudget,
              maxPerPosition: limits.maxPerPosition,
              maxTotalExposure: limits.maxTotalExposure,
              riskStyle: limits.riskStyle,
              interests: user.interests,
              excludedTopics: user.excludedTopics,
              notifyLevel: user.notifyLevel as "important" | "all" | "none",
            }}
          />
          <p className="mt-4 text-xs text-muted">Mayflower's risk engine — not the AI — enforces these limits, and also never exceeds your real available balance.</p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Beliefs</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          {theses.length === 0 ? <p className="text-sm text-muted">No beliefs recorded yet. Tell Mayflower what you think in chat, or add one here.</p> : null}
          <ul className="space-y-2">
            {theses.map((t) => (
              <li key={t.id} className="flex items-start justify-between gap-3 rounded-lg bg-surface-2 px-3 py-2 text-sm">
                <div>
                  <div className="font-medium">{t.topic}</div>
                  <div className="text-muted">“{t.belief}”</div>
                  <div className="mt-1 flex gap-1.5">
                    <Badge tone={t.stance === "bullish" ? "positive" : t.stance === "bearish" ? "negative" : "neutral"}>{t.stance}</Badge>
                    <Badge>{Math.round(t.confidence * 100)}% confident</Badge>
                    <Badge>via {t.source}</Badge>
                  </div>
                </div>
                <RemoveBelief id={t.id} />
              </li>
            ))}
          </ul>
          <AddBelief />
          <p className="text-xs text-muted">Beliefs shape what Mayflower looks for. They are context — never permission to trade — and they don't inflate its probability estimates.</p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Accounts & safety</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="font-medium">iMessage</div>
              <div className="text-muted">{user.imessageHandle ?? "Not set"}</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="font-medium">Gemini</div>
              <div className="text-muted">{conn ? modeLabel(conn.mode as never, conn.env as never) : defaultMode() === "needs_link" ? "Not linked — you'll link when you approve your first trade" : modeLabel(defaultMode() as never)}</div>
            </div>
            <Link href="/link" className="font-medium text-accent hover:underline">
              Manage
            </Link>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="font-medium">Trading</div>
              <div className="text-muted">{user.tradingPaused ? "Paused — no orders will be submitted." : "Active — every order still needs your approval."}</div>
            </div>
            <PauseToggle paused={user.tradingPaused} />
          </div>
          <div>
            <div className="font-medium">Connected context sources</div>
            <div className="mt-1 flex flex-wrap gap-2">
              {["Email", "Notion", "Slack", "Discord"].map((s) => (
                <span key={s} className="inline-flex items-center gap-1.5 text-muted">
                  {s} <FeatureBadge label="not_implemented" />
                </span>
              ))}
            </div>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
