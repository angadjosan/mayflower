import { NextResponse } from "next/server";
import { apiUser, isResponse, jsonError } from "@/server/session";
import { proposeExit } from "@/server/exits";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await apiUser();
  if (isResponse(user)) return user;
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { fraction?: number };
  const res = await proposeExit(user.id, id, typeof body.fraction === "number" ? body.fraction : 1);
  if (!res.ok) return jsonError(res.error, 409);
  return NextResponse.json({ proposalId: res.proposal.id });
}
