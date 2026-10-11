import { NextResponse } from "next/server";
import { apiUser, isResponse } from "@/server/session";
import { deactivateThesis } from "@/server/users";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await apiUser();
  if (isResponse(user)) return user;
  const { id } = await ctx.params;
  await deactivateThesis(user.id, id);
  return NextResponse.json({ ok: true });
}
