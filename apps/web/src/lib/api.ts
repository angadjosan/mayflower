import "server-only";
import { NextResponse } from "next/server";
import { getOrCreateUser, DEMO_COOKIE } from "./user";
import type { User } from "@mayflower/shared";

export async function withUser(fn: (user: User) => Promise<unknown>) {
  const { user, setCookie } = await getOrCreateUser();
  try {
    const body = await fn(user);
    const res = NextResponse.json(body ?? { ok: true });
    if (setCookie) res.cookies.set(DEMO_COOKIE, setCookie, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
    return res;
  } catch (e) {
    const err = e as Error & { code?: string };
    return NextResponse.json({ error: err.message, code: err.code ?? "ERROR" }, { status: 400 });
  }
}
