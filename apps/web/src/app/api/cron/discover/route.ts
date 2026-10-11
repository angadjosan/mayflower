import { NextResponse } from "next/server";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { runDiscovery } from "@/server/pipeline";
import { notifyRecommendations } from "@/server/conversation";
import { cronAuthorized } from "../auth";

export const maxDuration = 300;

/** Scheduled discovery for onboarded, unpaused users who haven't had a scan in the last 20 hours. */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = await getDb();
  const cutoff = new Date(Date.now() - 20 * 3600_000);
  const users = await db
    .select()
    .from(schema.users)
    .where(and(eq(schema.users.onboardingState, "complete"), eq(schema.users.tradingPaused, false), or(isNull(schema.users.lastDiscoveryAt), lt(schema.users.lastDiscoveryAt, cutoff))))
    .limit(25);
  const out: { user: string; analyzed: number; errors: string[] }[] = [];
  for (const u of users) {
    const r = await runDiscovery(u.id, { trigger: "scheduled", maxPersonalized: 1, maxGeneral: 1 });
    await notifyRecommendations(u.id, r.analyzed);
    out.push({ user: u.id, analyzed: r.analyzed.length, errors: r.errors });
  }
  return NextResponse.json({ users: out.length, results: out });
}
