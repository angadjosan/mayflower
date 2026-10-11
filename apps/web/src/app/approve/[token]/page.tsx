import Link from "next/link";
import { formatPct, formatUsd } from "@mayflower/shared";
import { inspectSignedLink } from "@/server/auth";
import { describeTerms, getProposal, termsHash } from "@/server/proposals";
import { activeConnection, defaultMode, modeLabel } from "@/server/gemini-link";
import { Card, CardBody } from "@/components/ui/primitives";
import { ApprovePanel } from "@/components/approve-panel";

export const dynamic = "force-dynamic";

export default async function ApproveTokenPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const claims = await inspectSignedLink(token, "approve");
  const proposal = claims?.pid ? await getProposal(claims.sub, claims.pid) : null;
  const valid = Boolean(claims && proposal && proposal.status === "pending" && proposal.termsHash === claims.th && termsHash(proposal) === claims.th && proposal.expiresAt && proposal.expiresAt > new Date());
  const conn = claims ? await activeConnection(claims.sub) : null;
  const mode = conn?.mode ?? defaultMode();

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-4 text-sm font-medium text-accent">Mayflower · confirm trade</div>
      <Card>
        <CardBody className="space-y-4 pt-5">
          {!valid || !proposal ? (
            <div>
              <h1 className="text-lg font-semibold">This approval link can't be used</h1>
              <p className="mt-1 text-sm text-muted">It may have expired, already been used, or the proposal changed. Nothing was ordered. Ask Mayflower to “approve” again for a fresh link.</p>
            </div>
          ) : (
            <>
              <div>
                <h1 className="text-lg font-semibold">{proposal.rationale.title}</h1>
                {proposal.side !== "sell" ? (
                  <p className="mt-1 text-sm text-muted">
                    Market implies {formatPct(proposal.marketProbability)}; Mayflower estimates {formatPct(proposal.estProbability)}. {proposal.rationale.sizingSummary}
                  </p>
                ) : (
                  <p className="mt-1 text-sm text-muted">{proposal.rationale.sizingSummary}</p>
                )}
              </div>
              <ApprovePanel
                endpoint={`/api/approve/${token}`}
                termsHash={proposal.termsHash ?? ""}
                termsText={describeTerms(proposal, proposal.rationale.title)}
                maxLoss={formatUsd(proposal.maxCost)}
                isSell={proposal.side === "sell"}
                modeNote={mode === "needs_link" ? "You'll link Gemini with trade-only access right after approving." : modeLabel(mode as never, (conn?.env as never) ?? undefined)}
              />
              <p className="text-xs text-muted">This link works once and expires in minutes. It approves only the exact order above.</p>
            </>
          )}
          <Link href="/dashboard" className="block text-center text-sm text-muted underline">
            Open dashboard
          </Link>
        </CardBody>
      </Card>
    </main>
  );
}
