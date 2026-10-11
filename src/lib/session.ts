// Sessions + signing helpers. Login is a one-time magic link DM'd over iMessage/Discord (see /api/auth/*).
import crypto from "crypto";
import { cookies } from "next/headers";
import { load, DEMO_USER_ID } from "./db";

export const SESSION_COOKIE = "mf_session";
const SECRET = process.env.SESSION_SECRET || "dev-insecure-session-secret";

export function sign(data: string): string {
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

/** Current signed-in user id; falls back to the demo user when nobody is signed in (local dev). */
export async function currentUserId(): Promise<string> {
  const raw = (await cookies()).get(SESSION_COOKIE)?.value;
  if (raw) {
    const i = raw.lastIndexOf(".");
    const userId = raw.slice(0, i), sig = raw.slice(i + 1);
    if (verify(userId, sig) && load().users.some((u) => u.id === userId)) return userId;
  }
  return DEMO_USER_ID;
}
