import { NextResponse } from "next/server";
import { approveAndExecute } from "@/lib/execution";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { token } = (await req.json().catch(() => ({}))) as { token?: string };
  const res = await approveAndExecute(id, token ?? "");
  return NextResponse.json(res, { status: res.ok || res.order ? 200 : 400 });
}
