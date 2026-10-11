import { NextResponse } from "next/server";
import { runTick } from "@/lib/loops/tick";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Legacy 10-minute endpoint (Trigger.dev schedule). Same work as /api/cron/tick: reconcile orders, then every
 * loop that's due (the monitor/contests/connectors job included), so it still works when no 30s runner exists.
 */
async function handler(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // Always run the monitor job here (this schedule exists for it); research loops run only when due.
  return NextResponse.json(await runTick({ force: ["monitor"] }));
}

export const GET = handler;
export const POST = handler;
