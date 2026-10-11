import { schedules, task } from "@trigger.dev/sdk";
import { discoverForUser, formatProposalForMessage } from "@mayflower/core";
import { getContainer } from "../src/lib/container";

/** Periodic market scan: discovery for every user with a budget; notify via iMessage. */
export const marketScan = schedules.task({
  id: "mayflower-market-scan",
  cron: "0 */6 * * *",
  run: async () => {
    const c = getContainer();
    const users = await c.repo.listUsersWithHandles();
    let created = 0;
    for (const user of users) {
      if (!user.riskLimits.totalBudget || user.riskLimits.paused) continue;
      const { proposals } = await discoverForUser(c, user, { max: 2 });
      created += proposals.length;
      if (proposals.length && c.imessage) {
        const text = (await Promise.all(proposals.map(async (p) => formatProposalForMessage(p, (await c.repo.getMarket(p.marketId))?.title ?? p.marketId)))).join("\n\n");
        await c.imessage.send({ userId: user.id, handle: user.imessageHandle ?? undefined, chatGuid: (await c.repo.getChatGuid(user.id)) ?? undefined }, `New ideas from your scan:\n\n${text}`);
      }
    }
    return { users: users.length, created };
  },
});

/** On-demand scan for one user (triggered from the API). */
export const scanUser = task({
  id: "mayflower-scan-user",
  run: async (payload: { userId: string }) => {
    const c = getContainer();
    const user = await c.repo.getUser(payload.userId);
    if (!user) return { skipped: true };
    const r = await discoverForUser(c, user, { max: 3 });
    return { proposals: r.proposals.length, noTrades: r.noTrades.length };
  },
});
