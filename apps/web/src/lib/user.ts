import "server-only";
import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import type { User } from "@mayflower/shared";
import { DEFAULT_RISK_LIMITS } from "@mayflower/shared";
import { getContainer } from "./container";
import { createClient, supabaseConfigured } from "./supabase/server";

export const DEMO_COOKIE = "mf_uid";

/**
 * Resolve the current user.
 *  - With Supabase Auth configured and a session → that user.
 *  - Otherwise → a per-browser demo user identified by cookie (clearly labelled in the UI).
 */
export async function getCurrentUser(): Promise<User | null> {
  const c = getContainer();
  if (supabaseConfigured()) {
    try {
      const sb = await createClient();
      const { data } = await sb.auth.getClaims();
      const sub = data?.claims?.sub as string | undefined;
      if (sub) return (await c.repo.getUser(sub)) ?? c.repo.upsertUser({ id: sub, email: data?.claims?.email as string | undefined, riskLimits: DEFAULT_RISK_LIMITS });
    } catch { /* fall through to demo user */ }
  }
  const jar = await cookies();
  const id = jar.get(DEMO_COOKIE)?.value;
  if (!id) return null;
  return (await c.repo.getUser(id)) ?? c.repo.upsertUser({ id, displayName: "Demo user", riskLimits: DEFAULT_RISK_LIMITS });
}

/** Route-handler helper: get or create the demo user and set the cookie. */
export async function getOrCreateUser(): Promise<{ user: User; setCookie: string | null }> {
  const existing = await getCurrentUser();
  if (existing) return { user: existing, setCookie: null };
  const id = randomUUID();
  const user = await getContainer().repo.upsertUser({ id, displayName: "Demo user", riskLimits: DEFAULT_RISK_LIMITS });
  return { user, setCookie: id };
}

export const isDemoMode = () => !supabaseConfigured();
