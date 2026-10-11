import { requireUser } from "@/server/session";
import { auditLog } from "@/server/views";
import { Badge, Card, CardBody } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

const LABELS: Record<string, string> = {
  "proposal.created": "Recommendation created",
  "proposal.no_trade": "Recommended no trade",
  "proposal.approved": "You approved an order",
  "proposal.rejected": "You rejected a proposal",
  "proposal.expired": "Proposal expired",
  "approval.challenge_issued": "Sent exact terms to confirm",
  "order.submitting": "Order being submitted",
  "order.submitted": "Order submitted to venue",
  "order.fill": "Fill recorded",
  "order.status": "Order status changed",
  "order.rejected": "Order rejected",
  "order.unknown": "Order status unknown",
  "order.cancelled": "Order cancelled",
  "execution.blocked": "Execution blocked by a safety check",
  "execution.awaiting_link": "Waiting for Gemini link",
  "monitor.event": "Monitoring update",
  "discovery.run": "Discovery scan",
  "profile.updated": "Profile updated",
  "trading.paused": "Trading paused",
  "trading.resumed": "Trading resumed",
  "gemini.linked": "Gemini linked",
  "gemini.disconnected": "Gemini disconnected",
  "chat.intent": "Message understood",
  "auth.login": "Signed in",
};

export default async function ActivityPage() {
  const user = await requireUser();
  const events = await auditLog(user.id, 200);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Activity</h1>
        <p className="text-sm text-muted">Every agent action, approval, order and setting change is logged here.</p>
      </div>
      <Card>
        <CardBody className="pt-5">
          <ul className="divide-y divide-border">
            {events.map((e) => (
              <li key={e.id} className="py-2.5 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={e.actor === "user" ? "info" : e.actor === "agent" ? "neutral" : "warning"}>{e.actor}</Badge>
                  <span className="font-medium">{LABELS[e.action] ?? e.action}</span>
                  <span className="ml-auto text-xs text-muted">{e.createdAt.toLocaleString()}</span>
                </div>
                {e.details ? (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs text-muted">details</summary>
                    <pre className="mt-1 overflow-x-auto rounded bg-surface-2 p-2 text-xs">{JSON.stringify(e.details, null, 2)}</pre>
                  </details>
                ) : null}
              </li>
            ))}
            {events.length === 0 ? <li className="py-4 text-sm text-muted">Nothing yet.</li> : null}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
