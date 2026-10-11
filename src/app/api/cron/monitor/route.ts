import { NextResponse } from "next/server";
import { reconcileOrders } from "@/lib/execution";
import { runMonitor } from "@/lib/monitor";
import { finalizeDueContests } from "@/lib/agent/group";
import { syncAll } from "@/lib/connectors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handler(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const orders = await reconcileOrders();
  const events = await runMonitor();
  const contestsScored = await finalizeDueContests();
  const connectors = await syncAll();
  return NextResponse.json({ reconciled: orders.length, events, contestsScored, connectors });
}

export const GET = handler;
export const POST = handler;
