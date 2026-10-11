import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { jwtVerify, SignJWT } from "jose";
import { blueBubblesConfigured, config } from "./config";
import { hashSecret, randomDigits, randomId, safeEqual } from "./crypto";
import { getDb, schema } from "./db/client";
import type { User } from "./db/schema";
import { isValidHandle, normalizeHandle, sendIMessage } from "./bluebubbles";
import { audit } from "./audit";
import { getOrCreateUserByHandle } from "./users";

export const SESSION_COOKIE = "mf_session";
const SESSION_DAYS = 30;

function secret(): Uint8Array {
  const s = config().sessionSecret;
  if (!s) throw new Error("SESSION_SECRET is required");
  return new TextEncoder().encode(s);
}

export async function createSessionToken(userId: string): Promise<string> {
  return new SignJWT({ purpose: "session" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secret());
}

export async function verifySessionToken(token: string | undefined | null): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    return payload.purpose === "session" && typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

export function sessionCookieOptions() {
  return { httpOnly: true, sameSite: "lax" as const, secure: config().isProd, path: "/", maxAge: SESSION_DAYS * 86400 };
}

export async function userFromSessionToken(token: string | undefined | null): Promise<User | null> {
  const userId = await verifySessionToken(token);
  if (!userId) return null;
  const db = await getDb();
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  return user ?? null;
}

// ---- iMessage sign-in codes -------------------------------------------------

export async function startLogin(rawHandle: string): Promise<{ ok: true; delivered: "imessage" | "dev"; devCode?: string; handle: string } | { ok: false; error: string }> {
  const handle = normalizeHandle(rawHandle);
  if (!isValidHandle(handle)) return { ok: false, error: "Enter the phone number or Apple ID email you use for iMessage." };
  const db = await getDb();
  const recent = await db
    .select()
    .from(schema.authCodes)
    .where(and(eq(schema.authCodes.handle, handle), gt(schema.authCodes.createdAt, new Date(Date.now() - 60_000))));
  if (recent.length >= 3) return { ok: false, error: "Too many codes requested. Wait a minute and try again." };
  const code = randomDigits(6);
  await db.insert(schema.authCodes).values({ handle, codeHash: hashSecret(code), expiresAt: new Date(Date.now() + 10 * 60_000) });
  const c = config();
  if (blueBubblesConfigured()) {
    const sent = await sendIMessage(handle, `Your Mayflower sign-in code is ${code}. It expires in 10 minutes. If you didn't request it, ignore this message.`);
    if (sent.ok) return { ok: true, delivered: "imessage", handle };
    if (!c.devLogin) return { ok: false, error: "We couldn't reach the iMessage bridge. Try again shortly." };
  } else if (!c.devLogin) {
    return { ok: false, error: "Sign-in over iMessage is unavailable right now (the iMessage bridge is offline)." };
  }
  return { ok: true, delivered: "dev", devCode: code, handle };
}

export async function verifyLogin(rawHandle: string, code: string): Promise<{ ok: true; user: User } | { ok: false; error: string }> {
  const handle = normalizeHandle(rawHandle);
  const db = await getDb();
  const [row] = await db
    .select()
    .from(schema.authCodes)
    .where(and(eq(schema.authCodes.handle, handle), isNull(schema.authCodes.consumedAt), gt(schema.authCodes.expiresAt, new Date())))
    .orderBy(desc(schema.authCodes.createdAt))
    .limit(1);
  if (!row) return { ok: false, error: "That code has expired. Request a new one." };
  if (row.attempts >= 5) return { ok: false, error: "Too many attempts. Request a new code." };
  if (!safeEqual(row.codeHash, hashSecret(code.replace(/\s/g, "")))) {
    await db.update(schema.authCodes).set({ attempts: row.attempts + 1 }).where(eq(schema.authCodes.id, row.id));
    return { ok: false, error: "That code doesn't match." };
  }
  await db.update(schema.authCodes).set({ consumedAt: new Date() }).where(eq(schema.authCodes.id, row.id));
  const user = await getOrCreateUserByHandle(handle);
  await audit({ userId: user.id, actor: "user", action: "auth.login", details: { method: "imessage_code" } });
  return { ok: true, user };
}

// ---- Signed one-time links (dashboard login from iMessage, trade approval) ----

export interface LinkClaims {
  sub: string;
  jti: string;
  purpose: "login" | "approve";
  pid?: string;
  th?: string;
}

export async function createSignedLink(userId: string, purpose: "login" | "approve", minutes: number, extra: { pid?: string; th?: string } = {}): Promise<string> {
  const jti = randomId(18);
  const db = await getDb();
  await db.insert(schema.oneTimeTokens).values({ jti, userId, purpose, expiresAt: new Date(Date.now() + minutes * 60_000) });
  const token = await new SignJWT({ purpose, ...extra })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime(`${minutes}m`)
    .sign(secret());
  const base = config().appUrl;
  return purpose === "login" ? `${base}/auth/magic?token=${token}` : `${base}/approve/${token}`;
}

/** Verify a signed link without consuming it (e.g. to render the confirmation page). */
export async function inspectSignedLink(token: string, purpose: "login" | "approve"): Promise<LinkClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (payload.purpose !== purpose || typeof payload.sub !== "string" || typeof payload.jti !== "string") return null;
    const db = await getDb();
    const [row] = await db.select().from(schema.oneTimeTokens).where(eq(schema.oneTimeTokens.jti, payload.jti)).limit(1);
    if (!row || row.usedAt || row.expiresAt < new Date() || row.userId !== payload.sub) return null;
    return { sub: payload.sub, jti: payload.jti, purpose, pid: payload.pid as string | undefined, th: payload.th as string | undefined };
  } catch {
    return null;
  }
}

/** Atomically consume a signed link. Returns claims only the first time. */
export async function consumeSignedLink(token: string, purpose: "login" | "approve"): Promise<LinkClaims | null> {
  const claims = await inspectSignedLink(token, purpose);
  if (!claims) return null;
  const db = await getDb();
  const used = await db
    .update(schema.oneTimeTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(schema.oneTimeTokens.jti, claims.jti), isNull(schema.oneTimeTokens.usedAt)))
    .returning();
  return used.length === 1 ? claims : null;
}
