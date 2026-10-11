import Link from "next/link";
import { notFound } from "next/navigation";
import { formatUsd } from "@mayflower/shared";
import { requireUser } from "@/server/session";
import { proposalView } from "@/server/views";
import { describeTerms, termsHash } from "@/server/proposals";
import { describeOrderStatus } from "@/server/execution";
import { activeConnection, defaultMode, modeLabel } from "@/server/gemini-link";
import { config } from "@/server/config";
import { Badge, Card, CardBody } from "@/components/ui/primitives";
import { ApprovePanel } from "@/components/approve-panel";
import { ProposalReasoning } from "@/components/proposal-detail";
import { RejectButton } from "@/components/actions";
import { ModeBadge } from "@/components/feature-badge";

export const dynamic = "force-dynamic";

export default async function ProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const view = await proposalView(user.id, id);
  if (!view) notFound();
  const p = view.proposal;
  const conn = await activeConnection(user.id);
  const mode = conn?.mode ?? defaultMode();
  const modeNote =
    mode === "needs_link"
      ? "After you approve, you'll link your own Gemini account with trade-only access (Mayflower can't withdraw or move money), then this exact order is submitted."
      : mode === "simulated"
        ? "SIMULATED: no exchange credentials are configured, so this fills against current quotes in Mayflower only."
        : `${modeLabel(mode as never, (conn?.env as never) ?? config().geminiEnv)} — limit order, never at a worse price than shown.`;
  const expired = p.expiresAt ? p.expiresAt < new Date() : false;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <Link href="/dashboard" className="text-sm text-muted hover:text-text">
        ← Dashboard
      </Link>
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={p.decision === "trade" ? "info" : "neutral"}>{p.decision === "trade" ? (p.side === "sell" ? `Proposed ${p.kind}` : "Proposed trade") : "No trade"}</Badge>
          <Badge>{p.status.replace("_", " ")}</Badge>
          {view.market?.source === "demo" ? <Badge tone="warning">DEMO market — not real</Badge> : null}
          <ModeBadge mode={mode === "needs_link" ? null : mode} env={conn?.env} />
        </div>
        <h1 className="mt-3 text-2xl font-semibold">{p.rationale.title}</h1>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="order-2 lg:order-1">
          <ProposalReasoning view={view} />
        </div>
        <aside className="order-1 lg:order-2">
          <Card className="lg:sticky lg:top-28">
            <CardBody className="space-y-3 pt-5">
              {p.decision !== "trade" ? (
                <div className="text-sm">
                  <div className="font-medium">Mayflower recommends no trade</div>
                  <p className="mt-1 text-muted">{p.rationale.noTradeReason}</p>
                </div>
              ) : p.status === "pending" && !expired ? (
                <>
                  <ApprovePanel
                    endpoint={`/api/proposals/${p.id}/approve`}
                    termsHash={p.termsHash ?? termsHash(p)}
                    termsText={describeTerms(p, p.rationale.title)}
                    maxLoss={formatUsd(p.maxCost)}
                    isSell={p.side === "sell"}
                    modeNote={modeNote}
                  />
                  <div className="flex justify-between">
                    <RejectButton proposalId={p.id} />
                    <span className="self-center text-xs text-muted">Expires {p.expiresAt?.toLocaleString()}</span>
                  </div>
                </>
              ) : p.status === "awaiting_link" ? (
                <div className="text-sm">
                  <div className="font-medium">Approved — waiting for your Gemini link</div>
                  <p className="mt-1 text-muted">Link your account and accept Gemini's terms; Mayflower then submits exactly: {describeTerms(p, p.rationale.title)}</p>
                  <Link href="/link" className="mt-2 inline-block font-medium text-accent underline">
                    Link Gemini →
                  </Link>
                </div>
              ) : view.order ? (
                <div className="text-sm">
                  <div className="font-medium">Order status</div>
                  <p className="mt-1 text-muted">{describeOrderStatus(view.order)}</p>
                </div>
              ) : (
                <div className="text-sm text-muted">This proposal is {expired && p.status === "pending" ? "expired" : p.status.replace("_", " ")}. Ask Mayflower for a fresh recommendation.</div>
              )}
            </CardBody>
          </Card>
        </aside>
      </div>
    </div>
  );
}
