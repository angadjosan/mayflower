// Cancel the signed-in user's working order. Reduces risk, so no approval link; filled contracts stay filled.
import { NextResponse } from "next/server";
import { cancelOrder } from "@/lib/execution";
import { sessionUserId, UNAUTHORIZED } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await sessionUserId();
  if (!userId) return NextResponse.json(UNAUTHORIZED, { status: 401 });
  const { id } = await params;
  const res = await cancelOrder(userId, id);
  return NextResponse.json(res, { status: res.ok ? 200 : res.error === "Order not found." ? 404 : 400 });
}
