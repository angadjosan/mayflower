import { and, eq } from "drizzle-orm";
import { ShieldCheck } from "lucide-react";
import { requireUser } from "@/server/session";
import { activeConnection, modeLabel, venueForConnection } from "@/server/gemini-link";
import { config, oauthConfigured, sharedSandboxConfigured } from "@/server/config";
import { getDb, schema } from "@/server/db/client";
import { describeTerms } from "@/server/proposals";
import { Badge, Card, CardBody, CardHeader, CardTitle, buttonVariants } from "@/components/ui/primitives";
import { AcceptTermsButton, DisconnectButton, FallbackModeButtons } from "@/components/link-actions";
import { ModeBadge } from "@/components/feature-badge";

export const dynamic = "force-dynamic";

export default async function LinkPage({ searchParams }: { searchParams: Promise<{ error?: string; linked?: string; terms?: string; submitted?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const conn = await activeConnection(user.id);
  const c = config();
  const db = await getDb();
  const waiting = await db
    .select()
    .from(schema.tradeProposals)
    .where(and(eq(schema.tradeProposals.userId, user.id), eq(schema.tradeProposals.status, "awaiting_link")));

  let terms: { needed: boolean; content: string | null; error: string | null } = { needed: false, content: null, error: null };
  if (conn?.mode === "oauth") {
    try {
      const venue = venueForConnection(user.id, conn);
      const status = await venue.termsStatus();
      if (!status.hasAcceptedLatest) terms = { needed: true, content: (await venue.getTerms())?.content ?? null, error: null };
    } catch (err) {
      terms = { needed: Boolean(sp.terms), content: null, error: (err as Error).message };
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <h1 className="text-2xl font-semibold">Gemini account</h1>
      {sp.error ? <div className="rounded-lg bg-negative-bg px-4 py-3 text-sm text-negative">{sp.error}</div> : null}
      {sp.linked ? (
        <div className="rounded-lg bg-positive-bg px-4 py-3 text-sm text-positive">
          Gemini linked with trade-only access.{sp.submitted ? ` ${sp.submitted} approved order(s) were submitted — see the dashboard for their status.` : ""}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Current connection</CardTitle>
          {conn ? <DisconnectButton /> : null}
        </CardHeader>
        <CardBody className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <ModeBadge mode={conn?.mode ?? null} env={conn?.env} />
            <span>{conn ? modeLabel(conn.mode as never, conn.env as never) : "Not linked"}</span>
          </div>
          {conn ? (
            <div className="text-muted">
              Linked {conn.linkedAt.toLocaleString()} · environment: {conn.env}
              {conn.scopes ? ` · scopes: ${conn.scopes}` : ""}
              {conn.mode === "oauth" ? ` · terms ${conn.termsAcceptedAt ? "accepted" : "not yet accepted"}` : ""}
            </div>
          ) : null}
        </CardBody>
      </Card>

      {terms.needed ? (
        <Card>
          <CardHeader>
            <CardTitle>Accept Gemini's prediction-market terms</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3 text-sm">
            <p className="text-muted">Gemini requires this on your account before your first prediction-market order. Read them, then accept — Mayflower will then submit any orders you already approved.</p>
            {terms.content ? <div className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg bg-surface-2 p-3 text-xs">{terms.content}</div> : null}
            {terms.error ? <p className="text-negative">Couldn't load the terms: {terms.error}</p> : null}
            <AcceptTermsButton />
          </CardBody>
        </Card>
      ) : null}

      {waiting.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Approved and waiting</CardTitle>
          </CardHeader>
          <CardBody>
            <ul className="space-y-2 text-sm">
              {waiting.map((p) => (
                <li key={p.id} className="rounded-lg bg-surface-2 px-3 py-2">
                  {describeTerms(p, p.rationale.title)}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted">These exact orders are submitted once your account is linked (and only if still within their limits and not expired).</p>
          </CardBody>
        </Card>
      ) : null}

      {conn?.mode !== "oauth" ? (
        <Card>
          <CardHeader>
            <CardTitle>Connect your own Gemini account</CardTitle>
            <Badge tone="info">{c.geminiEnv}</Badge>
          </CardHeader>
          <CardBody className="space-y-3 text-sm">
            <div className="flex gap-3 rounded-lg bg-surface-2 p-3">
              <ShieldCheck className="h-5 w-5 shrink-0 text-positive" />
              <div>
                <div className="font-medium">Trade-only access</div>
                <p className="text-muted">
                  Mayflower requests read access to balances and orders plus permission to place orders (the Trader role). It never requests the Fund Manager role or any scope that can withdraw, transfer or move money — and refuses the link if Gemini grants one. Your funds stay in your Gemini account; fund it in the Gemini app.
                </p>
              </div>
            </div>
            {oauthConfigured() ? (
              <a href="/api/gemini/oauth/start" className={buttonVariants({})}>
                Connect Gemini
              </a>
            ) : (
              <p className="text-muted">Gemini OAuth isn't configured on this server (GEMINI_OAUTH_CLIENT_ID / SECRET).</p>
            )}
            <p className="text-xs text-muted">
              No Gemini account yet?{" "}
              <a className="underline" href={c.geminiEnv === "sandbox" ? "https://exchange.sandbox.gemini.com" : "https://www.gemini.com"} target="_blank" rel="noreferrer noopener">
                Sign up with Gemini
              </a>
              , then come back.
            </p>
          </CardBody>
        </Card>
      ) : null}

      {conn?.mode !== "oauth" ? (
        <Card>
          <CardHeader>
            <CardTitle>Hackathon fallbacks</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3 text-sm">
            <p className="text-muted">
              {sharedSandboxConfigured()
                ? "Shared sandbox: orders go to Gemini's sandbox through one team API key; your allocation is tracked in Mayflower's ledger and labelled “Sandbox – shared account”."
                : "No shared sandbox key is configured."}{" "}
              Simulated mode never contacts an exchange: fills are simulated against current quotes and labelled SIMULATED.
            </p>
            <FallbackModeButtons shared={sharedSandboxConfigured()} />
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
