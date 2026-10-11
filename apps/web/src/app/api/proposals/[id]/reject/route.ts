import { NextResponse } from "next/server";
import { apiUser, isResponse, jsonError } from "@/server/session";
import { rejectProposal } from "@/server/proposals";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await apiUser();
  if (isResponse(user)) return user;
  const { id } = await ctx.params;
  const ok = await rejectProposal(user.id, id, "web");
  return ok ? NextResponse.json({ ok: true }) : jsonError("Nothing to reject.", 409);
}
