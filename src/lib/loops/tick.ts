// The heartbeat. An external runner calls /api/cron/tick every ~30s; each call reconciles orders, then runs
// whichever loops are due (last-run timestamps live in db.loopState), never two copies of the same loop at once.
import { tx, now } from "../db";
import { reconcileOrders } from "../execution";
import { refreshMarks } from "../marks";
import { runMonitor } from "../monitor";
import { finalizeDueContests } from "../agent/group";
import { syncAll } from "../connectors";
import { runAlphaScan } from "./alpha";
import { refreshPendingProposals } from "./pending";
import { checkTheses } from "./thesis";
import { runNewsCheckins } from "./newsCheckin";
import { runMemoryLoop } from "../memory";

const sec = (name: string, dflt: number) => {
  const n = Number(process.env[name]);
  return (isFinite(n) && n > 0 ? n : dflt) * 1000;
};

export const LOOP_NAMES = ["thesis", "pending", "alpha", "monitor", "news", "memory"] as const;
export type LoopName = (typeof LOOP_NAMES)[number];

export function loopIntervals(): Record<LoopName, number> {
  return {
    thesis: sec("LOOP_THESIS_SEC", 300),
    pending: sec("LOOP_PENDING_SEC", 600),
    alpha: sec("LOOP_ALPHA_SEC", 1800),
    monitor: sec("LOOP_MONITOR_SEC", 600),
    news: sec("LOOP_NEWS_SEC", 3600),
    memory: sec("LOOP_MEMORY_SEC", 1800),
  };
}

/** A loop still marked running after this long is assumed dead (crashed instance) and may start again. */
const STALE_RUN_MS = 5 * 60 * 1000;

const LOOPS: Record<LoopName, () => Promise<unknown>> = {
  thesis: checkTheses,
  pending: refreshPendingProposals,
  alpha: runAlphaScan,
  news: () => runNewsCheckins(),
  memory: runMemoryLoop,
  // The pre-existing 10-minute jobs: price/exit monitor, contest scoring, connector sync. Each isolated.
  monitor: async () => {
    const part = async <T,>(fn: () => Promise<T>) => {
      try { return await fn(); } catch (e) { return { error: (e as Error).message }; }
    };
    const events = await part(() => runMonitor());
    const contestsScored = await part(() => finalizeDueContests());
    const connectors = await part(() => syncAll());
    return { events, contestsScored, connectors };
  },
};

export interface TickResult {
  at: string;
  reconciled: number | { error: string };
  marks?: { marked: number; snapshots: number } | { error: string };
  ran: Record<string, { ms: number; result?: unknown; error?: string }>;
  skipped: Record<string, string>;
}

/** Atomically claim a loop if it's due (or forced) and not already running. */
async function claim(name: LoopName, intervalMs: number, force: boolean): Promise<string | null> {
  return tx((db) => {
    db.loopState ??= {};
    const s = (db.loopState[name] ??= {});
    const t = Date.now();
    if (s.running && s.startedAt && t - Date.parse(s.startedAt) < STALE_RUN_MS) return `running since ${s.startedAt}`;
    if (!force && s.lastRunAt && t - Date.parse(s.lastRunAt) < intervalMs) {
      return `not due (next in ${Math.ceil((intervalMs - (t - Date.parse(s.lastRunAt))) / 1000)}s)`;
    }
    s.running = true;
    s.startedAt = new Date(t).toISOString();
    return null;
  });
}

const errorOf = (r: unknown): string | undefined =>
  r && typeof r === "object" && "error" in r && typeof (r as { error: unknown }).error === "string" ? (r as { error: string }).error : undefined;

/** Approval links are bearer credentials: never echo their tokens in the tick response or loopState. */
function redact(r: unknown): unknown {
  if (r === undefined) return undefined;
  return JSON.parse(JSON.stringify(r).replace(/([?&]t=)[0-9a-f]{16,}/g, "$1[redacted]"));
}

/** Keep only a small summary in loopState (it lives in the single shared document). */
function summarize(r: unknown): unknown {
  const json = JSON.stringify(r ?? null, (k, v) => (k === "text" || k === "texts" ? undefined : v));
  return json.length <= 1500 ? JSON.parse(json) : `${json.slice(0, 1500)}…`;
}

export async function runTick(opts: { force?: LoopName[]; only?: LoopName[] } = {}): Promise<TickResult> {
  const out: TickResult = { at: now(), reconciled: 0, ran: {}, skipped: {} };
  try {
    out.reconciled = (await reconcileOrders()).length;
  } catch (e) {
    out.reconciled = { error: (e as Error).message };
  }
  try {
    out.marks = await refreshMarks();
  } catch (e) {
    out.marks = { error: (e as Error).message };
  }

  const intervals = loopIntervals();
  const names = LOOP_NAMES.filter((n) => !opts.only || opts.only.includes(n));
  await Promise.all(names.map(async (name) => {
    let reason: string | null;
    try {
      reason = await claim(name, intervals[name], !!opts.force?.includes(name));
    } catch (e) {
      out.skipped[name] = `claim failed: ${(e as Error).message}`;
      return;
    }
    if (reason) { out.skipped[name] = reason; return; }

    const started = Date.now();
    let result: unknown, error: string | undefined;
    try {
      result = redact(await LOOPS[name]());
      error = errorOf(result);
    } catch (e) {
      error = (e as Error).message;
    }
    out.ran[name] = { ms: Date.now() - started, ...(result !== undefined ? { result } : {}), ...(error ? { error } : {}) };
    await tx((db) => {
      db.loopState ??= {};
      const s = (db.loopState[name] ??= {});
      s.running = false;
      s.lastRunAt = new Date().toISOString();
      s.lastError = error;
      s.lastResult = summarize(result);
    }).catch((e) => console.warn("[tick] failed to record loop state", name, (e as Error).message));
  }));
  return out;
}
