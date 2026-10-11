import { NextResponse } from "next/server";
import { pingBlueBubbles } from "@/server/bluebubbles";

export async function GET() {
  const ping = await pingBlueBubbles();
  return NextResponse.json(ping, { status: ping.ok ? 200 : 503 });
}
