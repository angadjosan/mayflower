import { recordDecision } from "@mayflower/core";
import { getContainer } from "@/lib/container";
import { withUser } from "@/lib/api";
export const dynamic = "force-dynamic";
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { version } = (await req.json().catch(() => ({}))) as { version?: number };
  return withUser(async (user) => recordDecision(getContainer(), { userId: user.id, proposalId: id, version: version ?? 1, decision: "rejected", channel: "web", evidence: "dashboard:reject" }));
}
