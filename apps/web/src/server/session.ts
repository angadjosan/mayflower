import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, userFromSessionToken } from "./auth";
import type { User } from "./db/schema";

export async function getSessionUser(): Promise<User | null> {
  const jar = await cookies();
  return userFromSessionToken(jar.get(SESSION_COOKIE)?.value);
}

/** For server components: redirect to /login when signed out. */
export async function requireUser(): Promise<User> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

/** For route handlers. */
export async function apiUser(): Promise<User | NextResponse> {
  const user = await getSessionUser();
  return user ?? NextResponse.json({ error: "Not signed in" }, { status: 401 });
}

export function isResponse(x: unknown): x is NextResponse {
  return x instanceof NextResponse;
}

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}
