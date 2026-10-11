// Minimal JSON-file datastore (MVP). Swap for Supabase later behind the same API.
import fs from "fs";
import path from "path";
import crypto from "crypto";
import type {
  User, UserThesis, Market, ResearchReport, TradeProposal, Order, Position,
  ChatMessage, MonitorEvent, AuditEvent, PortfolioSnapshot,
} from "./types";

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
}

const FILE = path.join(process.cwd(), ".data", "db.json");
const empty = (): DB => ({
  users: [], theses: [], markets: [], research: [], proposals: [], orders: [],
  positions: [], messages: [], monitorEvents: [], audit: [], snapshots: [],
});

export function load(): DB {
  try {
    return { ...empty(), ...JSON.parse(fs.readFileSync(FILE, "utf8")) };
  } catch {
    return empty();
  }
}

export function save(db: DB) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(db, null, 2));
}

/** Read-modify-write helper. Synchronous so concurrent requests in one process don't interleave. */
export function tx<T>(fn: (db: DB) => T): T {
  const db = load();
  const out = fn(db);
  save(db);
  return out;
}

export const id = (prefix = "") => prefix + crypto.randomUUID().slice(0, 12);
export const now = () => new Date().toISOString();

export function audit(e: Omit<AuditEvent, "id" | "createdAt">) {
  tx((db) => { db.audit.push({ ...e, id: id("aud_"), createdAt: now() }); });
}

export const DEFAULT_LIMITS = {
  budgetUsd: 200, maxPerTradeUsd: 20, maxTotalExposureUsd: 100,
  riskStyle: "conservative" as const, excludedTopics: [] as string[],
};

/** Single-user MVP default: the web dashboard acts as this user. iMessage users are keyed by handle. */
export const DEMO_USER_ID = "user_demo";

export function getOrCreateUser(opts: { id?: string; handle?: string } = {}): User {
  return tx((db) => {
    let u = opts.handle
      ? db.users.find((x) => x.handle === opts.handle)
      : db.users.find((x) => x.id === (opts.id ?? DEMO_USER_ID));
    // MVP: first iMessage handle attaches to the demo user so web + iMessage share one conversation
    if (!u && opts.handle) {
      const demo = db.users.find((x) => x.id === DEMO_USER_ID && !x.handle);
      if (demo) { demo.handle = opts.handle; u = demo; }
    }
    if (!u) {
      u = {
        id: opts.handle ? id("user_") : opts.id ?? DEMO_USER_ID,
        handle: opts.handle, createdAt: now(), onboarded: false, paused: false,
        limits: { ...DEFAULT_LIMITS }, geminiLinked: false,
      };
      db.users.push(u);
    }
    return u;
  });
}
