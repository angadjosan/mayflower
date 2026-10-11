// Optional Mac "local texts" reader upload (scripts/local-texts). The script reads the user's OWN sent iMessages on
// their Mac, extracts interests/opinions locally with Claude, and uploads only those items here, authenticated by a
// per-user upload token. Only the token's sha256 is stored; minting a new one replaces it, revoking deletes it.
import crypto from "crypto";
import { tx, load, id, now, audit, type DB } from "./db";
import { addMemories, cleanMemoryInput, type MemoryInput } from "./memory";
import type { ContextItem, UserThesis } from "./types";

export const UPLOAD_TOKEN_PREFIX = "mfu_";
export const MAX_UPLOAD_ITEMS = 60;
const MAX_EXCERPT = 200;

const sha = (t: string) => crypto.createHash("sha256").update(t).digest("hex");
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** Stable id for the pseudo connected-source that owns everything uploaded from a user's local texts. */
export const localSourceId = (userId: string) => `src_local_${userId}`;

export async function mintUploadToken(userId: string): Promise<string> {
  const token = UPLOAD_TOKEN_PREFIX + crypto.randomBytes(32).toString("base64url");
  const at = now();
  await tx((db) => {
    const u = db.users.find((x) => x.id === userId);
    if (!u) throw new Error("unknown user");
    u.uploadTokenHash = sha(token);
    u.uploadTokenCreatedAt = at;
  });
  await audit({ userId, actor: "user", action: "ingest.token_minted" });
  return token;
}

export async function revokeUploadToken(userId: string): Promise<void> {
  await tx((db) => {
    const u = db.users.find((x) => x.id === userId);
    if (u) { delete u.uploadTokenHash; delete u.uploadTokenCreatedAt; }
  });
  await audit({ userId, actor: "user", action: "ingest.token_revoked" });
}

/** User id for a bearer upload token, or null. Pure, constant-time on the hash. */
export function userIdForUploadToken(db: Pick<DB, "users">, token: string | null | undefined): string | null {
  if (!token || !token.startsWith(UPLOAD_TOKEN_PREFIX) || token.length < 40) return null;
  const h = Buffer.from(sha(token));
  for (const u of db.users) {
    if (!u.uploadTokenHash) continue;
    const s = Buffer.from(u.uploadTokenHash);
    if (s.length === h.length && crypto.timingSafeEqual(s, h)) return u.id;
  }
  return null;
}

export const bearer = (h: string | null) => (h?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? null);

export interface UploadItem extends MemoryInput { excerpt?: string }

const PHONE = /\+?\d[\d\s().-]{7,}\d/;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/;

/** Validate an upload body. Drops malformed items and any excerpt with a phone number or email in it. */
export function parseUpload(body: unknown): UploadItem[] | string {
  if (!body || typeof body !== "object" || !Array.isArray((body as { items?: unknown }).items)) return "body must be {items: [...]}";
  const raw = (body as { items: unknown[] }).items;
  if (raw.length > MAX_UPLOAD_ITEMS) return `at most ${MAX_UPLOAD_ITEMS} items`;
  const out: UploadItem[] = [];
  for (const r of raw) {
    const m = cleanMemoryInput(r);
    if (!m || m.kind === "event" || PHONE.test(m.text) || EMAIL.test(m.text)) continue;
    const ex = (r as { excerpt?: unknown }).excerpt;
    const excerpt = typeof ex === "string" && ex.trim() && !PHONE.test(ex) && !EMAIL.test(ex) ? clip(ex.replace(/\s+/g, " ").trim(), MAX_EXCERPT) : undefined;
    out.push({ ...m, ...(excerpt ? { excerpt } : {}) });
  }
  return out;
}

/**
 * Store an upload in a tx. Each upload is a fresh snapshot: earlier local-texts memories, theses and excerpts for
 * this user are replaced. Never overwrites a thesis the user gave directly or another source produced.
 */
export function applyLocalTextsUpload(db: DB, userId: string, items: UploadItem[], at = now(), newId: (p: string) => string = id) {
  const sourceId = localSourceId(userId);
  let src = db.connectedSources.find((s) => s.id === sourceId);
  if (!src) {
    src = { id: sourceId, userId, provider: "local_texts", status: "connected", scopes: ["own_sent_messages:extracted"], tokenEnc: "", accountLabel: "Your Mac (local reader)", connectedAt: at };
    db.connectedSources.push(src);
  }
  src.status = "connected"; src.lastSyncedAt = at; src.lastError = undefined; delete src.revokedAt;

  db.memories = db.memories.filter((m) => !(m.userId === userId && m.sourceId === sourceId));
  db.theses = db.theses.filter((t) => t.sourceId !== sourceId);
  db.contextItems = db.contextItems.filter((c) => c.sourceId !== sourceId);

  const memories = addMemories(db, userId, items.map(({ excerpt: _e, ...m }) => { void _e; return m; }), "imessage_local", { at, sourceId, newId: () => newId("mem_") });
  const lc = (s: string) => s.trim().toLowerCase();
  const excluded = (db.users.find((u) => u.id === userId)?.limits.excludedTopics ?? []).map(lc);
  let theses = 0;
  const ctx: ContextItem[] = [];
  for (const it of items) {
    if (!it.topic || excluded.includes(lc(it.topic))) continue;
    if (it.kind === "belief" && !db.theses.some((t) => t.userId === userId && lc(t.topic) === lc(it.topic!))) {
      const th: UserThesis = { id: newId("th_"), userId, topic: it.topic, belief: it.text, confidence: Math.min(0.8, it.confidence ?? 0.5), source: "local_texts", sourceId, updatedAt: at };
      db.theses.push(th);
      theses++;
    }
    if (it.excerpt) ctx.push({ id: newId("ctx_"), userId, sourceId, provider: "local_texts", title: clip(`${it.topic} · your texts`, 120), excerpt: it.excerpt, createdAt: at });
  }
  db.contextItems.push(...ctx);
  return { memories: memories.length, theses, contextItems: ctx.length };
}

export async function ingestLocalTexts(userId: string, items: UploadItem[]) {
  const at = now();
  const r = await tx((db) => applyLocalTextsUpload(db, userId, items, at));
  await audit({ userId, actor: "user", action: "ingest.local_texts", detail: r });
  return r;
}

/** Delete everything a local-texts upload produced (used on revoke). */
export async function deleteLocalTexts(userId: string) {
  const sourceId = localSourceId(userId);
  await tx((db) => {
    db.memories = db.memories.filter((m) => !(m.userId === userId && m.sourceId === sourceId));
    db.theses = db.theses.filter((t) => t.sourceId !== sourceId);
    db.contextItems = db.contextItems.filter((c) => c.sourceId !== sourceId);
    const s = db.connectedSources.find((x) => x.id === sourceId);
    if (s) { s.status = "revoked"; s.revokedAt = now(); }
  });
}

export async function hasUploadToken(userId: string) {
  return Boolean((await load()).users.find((u) => u.id === userId)?.uploadTokenHash);
}
