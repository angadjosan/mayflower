import { NextResponse } from "next/server";
import { verifyContextWebhook } from "@mayflower/context";

export const dynamic = "force-dynamic";

/**
 * Context.dev monitor webhook (change.detected). Verifies X-Context-Signature.
 * Opening: map monitor id → market, then run the monitor agent for affected positions.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const sig = req.headers.get("x-context-signature") ?? "";
  const secret = process.env.CONTEXT_DEV_WEBHOOK_SECRET;
  if (secret && !(await verifyContextWebhook(raw, sig, secret))) return new NextResponse("bad signature", { status: 401 });
  const evt = JSON.parse(raw) as { event: string; id: string; data?: { change?: { monitor_id: string; summary: string; url: string } } };
  console.log("[context.dev] event", evt.event, evt.id, evt.data?.change?.summary);
  return NextResponse.json({ received: true });
}
