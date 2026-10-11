import { discoverForUser } from "@mayflower/core";
import { getContainer } from "@/lib/container";
import { withUser } from "@/lib/api";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function POST() {
  return withUser(async (user) => {
    const r = await discoverForUser(getContainer(), user, { max: 3 });
    return { proposals: r.proposals, noTrades: r.noTrades.map((n) => ({ marketId: n.market.id, title: n.market.title, reason: n.noTradeReason })) };
  });
}
