import { NextResponse } from "next/server";
import { approveByLink } from "@/server/proposals";
import { finishApproval } from "@/server/approval-flow";
import { getSessionUser, jsonError } from "@/server/session";

/** Confirm a signed, single-use approval link sent over iMessage. */
export async function POST(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const session = await getSessionUser();
  const res = await approveByLink(token, session?.id ?? null);
  if (!res.ok) return jsonError(res.error, 409);
  const done = await finishApproval(res, res.proposal.userId);
  return NextResponse.json(done, { status: done.status === "failed" || done.status === "blocked" ? 422 : 200 });
}
