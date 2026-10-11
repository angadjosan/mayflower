// Background worker for environments without Vercel Cron (e.g. the always-on BlueBubbles Mac or a VM).
// Runs monitoring every MONITOR_INTERVAL_MIN minutes and discovery every DISCOVERY_INTERVAL_MIN minutes
// by calling the same idempotent cron endpoints the hosted app exposes.
const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const secret = process.env.CRON_SECRET ?? "";
const monitorEvery = Number(process.env.MONITOR_INTERVAL_MIN ?? 15) * 60_000;
const discoverEvery = Number(process.env.DISCOVERY_INTERVAL_MIN ?? 360) * 60_000;

async function hit(path: string): Promise<void> {
  const started = Date.now();
  try {
    const res = await fetch(`${base}${path}`, { headers: secret ? { authorization: `Bearer ${secret}` } : {} });
    const body = await res.text();
    console.log(`[worker] ${path} ${res.status} in ${Date.now() - started}ms ${body.slice(0, 300)}`);
  } catch (err) {
    console.error(`[worker] ${path} failed:`, (err as Error).message);
  }
}

console.log(`[worker] monitoring ${base} every ${monitorEvery / 60_000}m, discovery every ${discoverEvery / 60_000}m`);
void hit("/api/cron/monitor");
setInterval(() => void hit("/api/cron/monitor"), monitorEvery);
setInterval(() => void hit("/api/cron/discover"), discoverEvery);
