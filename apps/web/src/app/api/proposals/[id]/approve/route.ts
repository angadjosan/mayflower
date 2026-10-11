import { approveAndExecute } from "@mayflower/core";
import { getContainer } from "@/lib/container";
import { withUser } from "@/lib/api";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Explicit approval of one exact proposal version from the dashboard. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { version } = (await req.json().catch(() => ({}))) as { version?: number };
  return withUser(async (user) => {
    const { order, proposal } = await approveAndExecute(getContainer(), { userId: user.id, proposalId: id, version: version ?? 1, channel: "web", evidence: "dashboard:approve" });
    return { order, proposal };
  });
}
