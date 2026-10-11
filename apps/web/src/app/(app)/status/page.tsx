import { and, eq, inArray } from "drizzle-orm";
import { requireUser } from "@/server/session";
import { featureStatuses } from "@/server/status";
import { config } from "@/server/config";
import { getDb, schema } from "@/server/db/client";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/primitives";
import { FeatureBadge } from "@/components/feature-badge";
import { DemoMarketMove } from "@/components/demo-tools";

export const dynamic = "force-dynamic";

export default async function StatusPage() {
  const user = await requireUser();
  const statuses = await featureStatuses({ deep: true });
  const demo = config().demoMode;
  const db = await getDb();
  const held = demo
    ? await db
        .select({ symbol: schema.positions.symbol, label: schema.markets.label })
        .from(schema.positions)
        .innerJoin(schema.markets, eq(schema.markets.symbol, schema.positions.symbol))
        .where(and(eq(schema.positions.userId, user.id), inArray(schema.positions.status, ["open"])))
    : [];
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">System status</h1>
        <p className="text-sm text-muted">Every feature is labelled honestly: live, sandbox, simulated, demo data, off, or not yet implemented.</p>
      </div>
      <Card>
        <CardBody className="pt-5">
          <ul className="divide-y divide-border">
            {statuses.map((s) => (
              <li key={s.key} className="flex flex-wrap items-start justify-between gap-2 py-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{s.name}</div>
                  <div className="text-sm text-muted">{s.detail}</div>
                </div>
                <FeatureBadge label={s.label} />
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
      {demo ? (
        <Card>
          <CardHeader>
            <CardTitle>Demo tools</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2 text-sm">
            <p className="text-muted">Demo mode only: simulate a market move plus a news item on a position you hold, then run “Check positions now” to watch Mayflower propose (not execute) an adjustment.</p>
            <DemoMarketMove positions={held} />
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
