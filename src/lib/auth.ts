// Passwordless login: a one-time magic link DM'd to the user over their chat channel (iMessage today, Discord DMs next).
// The account itself is created from messages (getOrCreateUser by handle), so there's no second identity system.
import crypto from "crypto";
import { tx, load, id, now, audit } from "./db";
import { sendToUser } from "./notify";

const APP_URL = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
const TTL_MS = 15 * 60 * 1000;

export const LOGIN_SENT_MESSAGE =
  "If that handle belongs to a Mayflower account, we just sent a sign-in link to your Messages. It expires in 15 minutes.";

const hash = (t: string) => crypto.createHash("sha256").update(t).digest("hex");

/** Only allow same-origin relative redirects (blocks open redirects like `//evil.com` or `https://...`). */
export function safeNext(next?: string | null): string | undefined {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return undefined;
  return next;
}

/** Create a one-time login link for a user. Only the sha256 of the token is stored. */
export async function createLoginLink(userId: string, next?: string): Promise<string> {
  const token = crypto.randomBytes(32).toString("base64url");
  const t = Date.now();
  await tx((db) => {
    // prune expired/used tokens while we're here
    db.loginTokens = db.loginTokens.filter((x) => !x.usedAt && Date.parse(x.expiresAt) > t);
    db.loginTokens.push({
      id: id("lt_"), userId, tokenHash: hash(token), next: safeNext(next),
      expiresAt: new Date(t + TTL_MS).toISOString(),
    });
  });
  return `${APP_URL}/api/auth/callback?t=${token}`;
}

/** Consume a login token (one-time). Returns the user id and stored redirect, or null if invalid/expired/used. */
export async function consumeLoginToken(token: string): Promise<{ userId: string; next?: string } | null> {
  if (!token) return null;
  const h = hash(token);
  return await tx((db) => {
    const lt = db.loginTokens.find((x) => x.tokenHash === h);
    if (!lt || lt.usedAt || Date.parse(lt.expiresAt) <= Date.now()) return null;
    if (!db.users.some((u) => u.id === lt.userId)) return null;
    lt.usedAt = now();
    return { userId: lt.userId, next: lt.next };
  });
}

/** Canonical form of a chat handle: phones → E.164-ish (+1 for 10-digit US), emails/Apple IDs lowercased, `discord:` kept. */
export function normalizeHandle(raw: string): string {
  const s = raw.trim();
  if (!s) return "";
  if (/^discord:/i.test(s)) return "discord:" + s.slice(8).trim().toLowerCase();
  if (s.includes("@")) return s.toLowerCase();
  if (/^[+\d\s().-]+$/.test(s)) {
    const digits = s.replace(/\D/g, "");
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
    return `+${digits}`;
  }
  return s.toLowerCase();
}

export async function findUserByHandle(handle: string) {
  const want = normalizeHandle(handle);
  if (!want) return undefined;
  return (await load()).users.find((u) => u.handle && normalizeHandle(u.handle) === want);
}

/** Look up the account by handle and DM it a login link. Always returns the same generic message (no account enumeration). */
export async function requestLogin(handle: string, next?: string): Promise<{ ok: true; message: string }> {
  const user = await findUserByHandle(handle || "");
  if (user) {
    try {
      const link = await createLoginLink(user.id, next);
      await sendToUser(user.id, `Your Mayflower dashboard link (expires in 15 min): ${link}`);
      await audit({ userId: user.id, actor: "system", action: "auth.login_link_sent" });
    } catch (e) {
      console.error("requestLogin failed", e);
    }
  }
  return { ok: true, message: LOGIN_SENT_MESSAGE };
}
