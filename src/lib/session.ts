// Sessions + signing helpers. Login is a one-time magic link DM'd over iMessage/Discord (see /api/auth/*).
import crypto from "crypto";
import { cookies, headers } from "next/headers";
import { load, DEMO_USER_ID } from "./db";

export const SESSION_COOKIE = "mf_session";
const SECRET = process.env.SESSION_SECRET || "dev-insecure-session-secret";

export function sign(data: string): string {
  // Checked at use, not import, so `next build` works without it.
  if (!process.env.SESSION_SECRET && process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET must be set in production (openssl rand -base64 32)");
  }
  return crypto.createHmac("sha256", SECRET).update(data).digest("base64url");
}

export function verify(data: string, sig: string): boolean {
  const a = Buffer.from(sign(data)), b = Buffer.from(sig);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Session cookie value: `<userId>.<sig>`. */
export function sessionValue(userId: string) {
  return `${userId}.${sign(userId)}`;
}

export class UnauthorizedError extends Error {
  constructor() { super("Sign in required"); }
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * True only for a request made directly to this machine (e.g. http://localhost:3000), not through a tunnel.
 * Tunnels (ngrok, cloudflared) either keep the public Host or add x-forwarded-for, so both are checked.
 */
export function isLocalRequest(h: { get(name: string): string | null }): boolean {
  const host = (h.get("host") || "").replace(/:\d+$/, "").toLowerCase();
  return LOCAL_HOSTS.has(host) && !h.get("x-forwarded-for") && !h.get("cf-connecting-ip");
}

/** The demo user is only a fallback for local dev on this machine, never for requests through a public tunnel. */
async function demoFallbackAllowed(): Promise<boolean> {
  if (process.env.ALLOW_DEMO_USER === "1") return true;
  if (process.env.NODE_ENV === "production") return false;
  return isLocalRequest(await headers());
}

/**
 * Current signed-in user id. Signed out, it falls back to the demo user only for local requests;
 * otherwise it throws UnauthorizedError (routes map it to 401).
 */
export async function currentUserId(): Promise<string> {
  const raw = (await cookies()).get(SESSION_COOKIE)?.value;
  if (raw) {
    const i = raw.lastIndexOf(".");
    const userId = raw.slice(0, i), sig = raw.slice(i + 1);
    if (verify(userId, sig) && load().users.some((u) => u.id === userId)) return userId;
  }
  if (await demoFallbackAllowed()) return DEMO_USER_ID;
  throw new UnauthorizedError();
}

/** Like currentUserId, but null instead of throwing when signed out. Routes return 401 on null. */
export async function sessionUserId(): Promise<string | null> {
  try {
    return await currentUserId();
  } catch (e) {
    if (e instanceof UnauthorizedError) return null;
    throw e;
  }
}

export const UNAUTHORIZED = { error: "Sign in required" } as const;
