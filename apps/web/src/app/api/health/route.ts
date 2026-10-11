import { NextResponse } from "next/server";
import { getContainer } from "@/lib/container";

export const dynamic = "force-dynamic";

/** Honest integration status: live / sandbox / simulated / mock / not configured. */
export async function GET() {
  const c = getContainer();
  const imessage = c.imessage ? await c.imessage.healthy() : false;
  return NextResponse.json({ ok: true, status: { ...c.status, imessage: { ...c.status.imessage, reachable: imessage } }, time: new Date().toISOString() });
}
