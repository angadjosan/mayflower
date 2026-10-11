// Datastore. Server-only: never import this from a "use client" module (the Supabase service role key lives here).
//
// The whole app state is one JSON document (`DB`). Two backends, chosen by env:
//  - Supabase Postgres when SUPABASE_URL + SUPABASE_SECRET_KEY are set: a single row in `mayflower_state`
//    (see supabase/migrations/0001_mayflower_state.sql), updated with optimistic concurrency on `version`, so `tx`
//    is atomic across processes and serverless instances.
//  - Otherwise a local JSON file (.data/db.json) for dev, guarded by an in-process mutex and written atomically
//    (temp file + rename). Separate processes writing the file can still lose updates; use Supabase for that.
//
// `tx(fn)` contract: `fn` mutates the doc in place and may run MORE THAN ONCE (Supabase retries on conflict), so it
// must be free of external side effects (no fetch / sendToUser / placeOrder / audit / nested tx). Do I/O after it.
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { AsyncLocalStorage } from "async_hooks";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  User, UserThesis, Market, ResearchReport, TradeProposal, Order, Position,
  ChatMessage, MonitorEvent, AuditEvent, PortfolioSnapshot,
  Group, Contest, ContestEntry, GroupPick,
  ConnectedSource, ContextItem, AuditReceipt, ForecastScore, LoginToken, LoopState, Memory, NewsCheckin,
} from "./types";

if (typeof window !== "undefined") throw new Error("lib/db is server-only");

export interface DB {
  users: User[];
  theses: UserThesis[];
  markets: Market[];
  research: ResearchReport[];
  proposals: TradeProposal[];
  orders: Order[];
  positions: Position[];
  messages: ChatMessage[];
  monitorEvents: MonitorEvent[];
  audit: AuditEvent[];
  snapshots: PortfolioSnapshot[];
  groups: Group[];
  contests: Contest[];
  contestEntries: ContestEntry[];
  groupPicks: GroupPick[];
  connectedSources: ConnectedSource[];
  contextItems: ContextItem[];
  auditReceipts: AuditReceipt[];
  forecastScores: ForecastScore[];
  loginTokens: LoginToken[];
  loopState: Record<string, LoopState>; // background research loops (see src/lib/loops/tick.ts)
  memories: Memory[]; // durable per-user memory (src/lib/memory.ts)
  newsCheckins: NewsCheckin[]; // "what do you think?" news texts (src/lib/loops/newsCheckin.ts)
}

const empty = (): DB => ({
  users: [], theses: [], markets: [], research: [], proposals: [], orders: [],
  positions: [], messages: [], monitorEvents: [], audit: [], snapshots: [],
  groups: [], contests: [], contestEntries: [], groupPicks: [],
  connectedSources: [], contextItems: [], auditReceipts: [], forecastScores: [], loginTokens: [],
  loopState: {}, memories: [], newsCheckins: [],
});
const normalize = (raw: unknown): DB => ({ ...empty(), ...((raw && typeof raw === "object" ? raw : {}) as Partial<DB>) });

// Detects nested tx (would deadlock the file mutex and break Supabase retry semantics).
const inTx = new AsyncLocalStorage<true>();

// ---------------------------------------------------------------- Supabase backend

export const TABLE = "mayflower_state";
export const ROW_ID = "main";
const MAX_ATTEMPTS = 8;

/** Minimal surface of the Supabase client used here (lets tests inject a stub). */
export type StateClient = Pick<SupabaseClient, "from">;

let client: StateClient | null = null;
let clientOverride: StateClient | null | undefined;

/** Test hook: force the Supabase backend with a given client (null = force file backend, undefined = use env). */
export function __setClientForTests(c: StateClient | null | undefined) {
  clientOverride = c;
}

function supabase(): StateClient | null {
  if (clientOverride !== undefined) return clientOverride;
  // Secret key (sb_secret_…) bypasses RLS like the legacy service_role key; server-side only, never NEXT_PUBLIC_.
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  client ??= createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function supaRead(sb: StateClient): Promise<{ data: DB; version: number } | null> {
  const { data, error } = await sb.from(TABLE).select("data, version").eq("id", ROW_ID).maybeSingle();
  if (error) throw new Error(`Supabase read failed: ${error.message}`);
  if (!data) return null;
  const row = data as { data: unknown; version: number | string };
  return { data: normalize(row.data), version: Number(row.version) };
}

async function supaTx<T>(sb: StateClient, fn: (db: DB) => T | Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const row = await supaRead(sb);
    if (!row) {
      // First write ever: create the row. A concurrent creator wins the race with a unique violation; just re-read.
      const { error } = await sb.from(TABLE).insert({ id: ROW_ID, data: empty(), version: 0 });
      if (error && error.code !== "23505") throw new Error(`Supabase insert failed: ${error.message}`);
      continue;
    }
    const before = JSON.stringify(row.data);
    const out = await fn(row.data);
    const after = JSON.stringify(row.data);
    if (after === before) return out; // read-only: the snapshot we read was consistent, nothing to write
    const { data, error } = await sb
      .from(TABLE)
      .update({ data: JSON.parse(after), version: row.version + 1, updated_at: new Date().toISOString() })
      .eq("id", ROW_ID)
      .eq("version", row.version)
      .select("version");
    if (error) throw new Error(`Supabase update failed: ${error.message}`);
    if (Array.isArray(data) && data.length > 0) return out;
    // Someone else committed first: back off with jitter and redo the whole read-modify-write.
    await sleep(Math.random() * 25 * attempt);
  }
  throw new Error(`Datastore busy: transaction conflicted ${MAX_ATTEMPTS} times, giving up`);
}

// ---------------------------------------------------------------- File backend (dev fallback)

// Vercel's filesystem is read-only except /tmp, which is per-instance and wiped on cold start —
// set SUPABASE_URL + SUPABASE_SECRET_KEY for real persistence there.
const FILE = process.env.VERCEL ? "/tmp/mayflower/db.json" : path.join(process.cwd(), ".data", "db.json");
let fileLock: Promise<void> = Promise.resolve();

function fileRead(): DB {
  try {
    return normalize(JSON.parse(fs.readFileSync(FILE, "utf8")));
  } catch {
    return empty();
  }
}

function fileWrite(db: DB) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.${process.pid}.${crypto.randomUUID().slice(0, 8)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, FILE);
}

async function fileTx<T>(fn: (db: DB) => T | Promise<T>): Promise<T> {
  const prev = fileLock;
  let release!: () => void;
  fileLock = new Promise<void>((r) => (release = r));
  await prev;
  try {
    const db = fileRead();
    const out = await fn(db);
    fileWrite(db);
    return out;
  } finally {
    release();
  }
}

// ---------------------------------------------------------------- Public API

/** Snapshot of the whole state. Mutating it does nothing; use `tx` to write. */
export async function load(): Promise<DB> {
  const sb = supabase();
  if (!sb) return fileRead();
  return (await supaRead(sb))?.data ?? empty();
}

/** Atomic read-modify-write. `fn` may be retried, so it must not perform external I/O (see header). */
export async function tx<T>(fn: (db: DB) => T | Promise<T>): Promise<T> {
  if (inTx.getStore()) throw new Error("Nested tx() is not allowed; do the inner write after the outer tx returns");
  const sb = supabase();
  return inTx.run(true, () => (sb ? supaTx(sb, fn) : fileTx(fn)));
}

export const id = (prefix = "") => prefix + crypto.randomUUID().slice(0, 12);
export const now = () => new Date().toISOString();

export async function audit(e: Omit<AuditEvent, "id" | "createdAt">): Promise<void> {
  const ev: AuditEvent = { ...e, id: id("aud_"), createdAt: now() };
  await tx((db) => { db.audit.push(ev); });
}

export const DEFAULT_LIMITS = {
  budgetUsd: 200, maxPerTradeUsd: 20, maxTotalExposureUsd: 100,
  riskStyle: "conservative" as const, excludedTopics: [] as string[],
};

/** Single-user MVP default: the web dashboard acts as this user. iMessage users are keyed by handle. */
export const DEMO_USER_ID = "user_demo";
export const DEFAULT_TIMEZONE = "America/Los_Angeles";

export async function getOrCreateUser(opts: { id?: string; handle?: string; attachDemo?: boolean } = {}): Promise<User> {
  const newId = id("user_"), createdAt = now(); // generated outside fn so retries are deterministic
  return tx((db) => {
    let u = opts.handle
      ? db.users.find((x) => x.handle === opts.handle)
      : db.users.find((x) => x.id === (opts.id ?? DEMO_USER_ID));
    // MVP: first iMessage handle attaches to the demo user so web + iMessage share one conversation
    if (!u && opts.handle && opts.attachDemo !== false) {
      const demo = db.users.find((x) => x.id === DEMO_USER_ID && !x.handle);
      if (demo) { demo.handle = opts.handle; u = demo; }
    }
    if (!u) {
      u = {
        id: opts.handle ? newId : opts.id ?? DEMO_USER_ID,
        handle: opts.handle, createdAt, onboarded: false, paused: false,
        limits: { ...DEFAULT_LIMITS }, geminiLinked: false, timezone: DEFAULT_TIMEZONE,
      };
      db.users.push(u);
    }
    return { ...u };
  });
}
