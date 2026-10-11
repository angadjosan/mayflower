import { NextResponse } from "next/server";
import { runTick, LOOP_NAMES, type LoopName } from "@/lib/loops/tick";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const parseLoops = (v: string | null): LoopName[] | undefined => {
  const names = (v ?? "").split(",").map((s) => s.trim()).filter((s): s is LoopName => (LOOP_NAMES as readonly string[]).includes(s));
  return names.length ? names : undefined;
};

/**
 * Called every ~30s by an external runner. Reconciles orders every call, then runs whichever research loops
 * are due. `?force=alpha,thesis` runs those now regardless of schedule; `?only=pending` limits the tick.
 */
async function handler(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const result = await runTick({ force: parseLoops(url.searchParams.get("force")), only: parseLoops(url.searchParams.get("only")) });
  return NextResponse.json(result);
}

export const GET = handler;
export const POST = handler;
