import { schedules } from "@trigger.dev/sdk";
import { monitorUser, reconcileOrder, shortRef } from "@mayflower/core";
import { getContainer } from "../src/lib/container";

/** Position monitoring + open-order reconciliation. Notifies only notable changes. */
export const positionMonitor = schedules.task({
  id: "mayflower-position-monitor",
  cron: "*/30 * * * *",
  run: async () => {
    const c = getContainer();
    const users = await c.repo.listUsersWithHandles();
    let notified = 0;
    for (const user of users) {
      for (const o of await c.repo.listOrders(user.id)) if (["submitted", "open", "partially_filled"].includes(o.status)) await reconcileOrder(c, o).catch(() => undefined);
      const events = await monitorUser(c, user);
      if (events.length && c.imessage) {
        const text = events.map((e) => `• ${e.summary} → I suggest: ${e.recommendation}${e.proposalId ? ` (approve ${shortRef(e.proposalId)} if you agree)` : ""}`).join("\n");
        await c.imessage.send({ userId: user.id, handle: user.imessageHandle ?? undefined, chatGuid: (await c.repo.getChatGuid(user.id)) ?? undefined }, `Update on your positions:\n${text}`);
        for (const e of events) { e.notified = true; }
        notified += events.length;
      }
    }
    return { users: users.length, notified };
  },
});
