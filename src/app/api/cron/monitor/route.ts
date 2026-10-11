import { NextResponse } from "next/server";
import { reconcileOrders } from "@/lib/execution";
import { runMonitor } from "@/lib/monitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handler(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const orders = await reconcileOrders();
  const events = await runMonitor();
  return NextResponse.json({ reconciled: orders.length, events });
}

export const GET = handler;
export const POST = handler;
