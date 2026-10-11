import { NextResponse } from "next/server";
import { tx, audit, DEMO_USER_ID, getOrCreateUser } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// MVP Plan B: all users trade through one shared Gemini sandbox account.
// TODO: per-user Gemini OAuth once available.
export async function POST() {
  getOrCreateUser({ id: DEMO_USER_ID });
  const user = tx((db) => {
    const u = db.users.find((x) => x.id === DEMO_USER_ID)!;
    u.geminiLinked = true;
    return u;
  });
  audit({ userId: DEMO_USER_ID, actor: "user", action: "gemini_linked", detail: { account: "Sandbox – shared account" } });
  return NextResponse.json({ user, account: "Sandbox – shared account" });
}
