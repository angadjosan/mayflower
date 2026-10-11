import { NextResponse } from "next/server";
import { currentUserId } from "@/lib/session";
import { load } from "@/lib/db";
import { commitPolicy, listReceipts, receiptsOnchainEnabled, verifyReceipt, BSC_TESTNET_EXPLORER } from "@/lib/receipts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET: current user's receipts. GET ?verify=<receiptId>: recompute and check one receipt. */
export async function GET(req: Request) {
  const userId = await currentUserId();
  const verifyId = new URL(req.url).searchParams.get("verify");
  if (verifyId) {
    const r = load().auditReceipts.find((x) => x.id === verifyId);
    if (!r || r.userId !== userId) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(await verifyReceipt(verifyId));
  }
  return NextResponse.json({
    receipts: listReceipts(userId),
    onchainEnabled: receiptsOnchainEnabled(),
    chain: "bsc-testnet",
    explorer: BSC_TESTNET_EXPLORER,
  });
}

/** POST {kind:"policy"}: hash the user's current risk policy and commit it. */
export async function POST(req: Request) {
  const userId = await currentUserId();
  const body = (await req.json().catch(() => ({}))) as { kind?: string };
  if (body.kind !== "policy") return NextResponse.json({ error: "only kind \"policy\" can be committed here" }, { status: 400 });
  try {
    const receipt = await commitPolicy(userId);
    return NextResponse.json({ receipt });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
