import { NextResponse } from "next/server";
import { currentUserId } from "@/lib/session";
import { discover } from "@/lib/agent/discover";
import { sendToUser } from "@/lib/notify";
import { approvalUrl } from "@/lib/execution";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { focus } = (await req.json().catch(() => ({}))) as { focus?: string };
  const userId = await currentUserId();
  try {
    const proposals = await discover(userId, { focus: focus || undefined });
    const msg = proposals.length
      ? `I found ${proposals.length} trade idea${proposals.length === 1 ? "" : "s"}${focus ? ` on "${focus}"` : ""}:\n` +
        proposals.map((p, i) => `${i + 1}. ${p.side} on "${p.market.title}": ${p.quantity} @ $${p.limitPrice.toFixed(2)} (max loss $${p.costUsd.toFixed(2)})\n   Review & approve: ${approvalUrl(p)}`).join("\n") +
        "\nNothing is placed until you approve the exact order."
      : `I didn't find anything worth trading${focus ? ` on "${focus}"` : ""} right now — no edge large enough after research.`;
    await sendToUser(userId, msg);
    return NextResponse.json({ proposals });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "discover failed" }, { status: 500 });
  }
}
