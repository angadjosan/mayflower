import { NextResponse } from "next/server";
import { apiUser, isResponse, jsonError } from "@/server/session";
import { approveProposal } from "@/server/proposals";
import { finishApproval } from "@/server/approval-flow";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await apiUser();
  if (isResponse(user)) return user;
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { termsHash?: string };
  if (!body.termsHash) return jsonError("Missing terms confirmation.");
  const res = await approveProposal({ userId: user.id, proposalId: id, termsHash: body.termsHash, channel: "web" });
  if (!res.ok) return jsonError(res.error, res.code === "not_found" ? 404 : 409);
  const done = await finishApproval(res, user.id);
  return NextResponse.json(done, { status: done.status === "failed" || done.status === "blocked" ? 422 : 200 });
}
