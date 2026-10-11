// Mayflower ticker: calls the app's tick endpoint every TICK_SECONDS (default 30).
// The app decides which loops are due, so this stays dumb. Calls never overlap.
const URL_ = `${(process.env.MAYFLOWER_URL || "").replace(/\/$/, "")}/api/cron/tick`;
const SECRET = process.env.CRON_SECRET || "";
const EVERY_MS = (Number(process.env.TICK_SECONDS) || 30) * 1000;
if (!process.env.MAYFLOWER_URL || !SECRET) { console.error("MAYFLOWER_URL and CRON_SECRET are required"); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (;;) {
  const t0 = Date.now();
  try {
    const res = await fetch(URL_, { method: "POST", headers: { Authorization: `Bearer ${SECRET}` }, signal: AbortSignal.timeout(295_000) });
    const body = (await res.text()).slice(0, 300).replace(/\s+/g, " ");
    console.log(new Date().toISOString(), res.status, `${Date.now() - t0}ms`, body);
  } catch (e) {
    console.error(new Date().toISOString(), "tick failed:", e.message);
  }
  await sleep(Math.max(1000, EVERY_MS - (Date.now() - t0)));
}
