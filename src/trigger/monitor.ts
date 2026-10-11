import { schedules, logger } from "@trigger.dev/sdk";

// Every 10 minutes: hit the app's monitor endpoint (reconcile orders, re-check positions, score contests).
// Set APP_URL and CRON_SECRET in the Trigger.dev environment variables.
export const monitorSchedule = schedules.task({
  id: "mayflower-monitor",
  cron: "*/10 * * * *",
  maxDuration: 240,
  run: async () => {
    const base = (process.env.APP_URL || "").replace(/\/$/, "");
    if (!base) throw new Error("APP_URL is not set in the Trigger.dev environment");
    const headers: Record<string, string> = {};
    if (process.env.CRON_SECRET) headers.Authorization = `Bearer ${process.env.CRON_SECRET}`;
    const res = await fetch(`${base}/api/cron/monitor`, { method: "POST", headers });
    const text = await res.text();
    if (!res.ok) throw new Error(`monitor returned ${res.status}: ${text.slice(0, 500)}`);
    let body: unknown = text;
    try { body = JSON.parse(text); } catch { /* keep raw text */ }
    logger.info("monitor ok", { body });
    return body;
  },
});
