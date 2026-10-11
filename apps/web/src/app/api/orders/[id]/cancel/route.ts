import { NextResponse } from "next/server";
import { apiUser, isResponse, jsonError } from "@/server/session";
import { cancelOrder } from "@/server/execution";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await apiUser();
  if (isResponse(user)) return user;
  const { id } = await ctx.params;
  const r = await cancelOrder(user.id, id);
  return r.ok ? NextResponse.json(r) : jsonError(r.message, 409);
}
