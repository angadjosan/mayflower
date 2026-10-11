import { NextResponse } from "next/server";
import { z } from "zod";
import { apiUser, isResponse, jsonError } from "@/server/session";
import { addThesis } from "@/server/users";

const Body = z.object({ topic: z.string().min(1).max(80), belief: z.string().min(1).max(400), stance: z.enum(["bullish", "bearish", "neutral"]), confidence: z.coerce.number().min(0).max(1) });

export async function POST(req: Request) {
  const user = await apiUser();
  if (isResponse(user)) return user;
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Invalid belief.");
  await addThesis(user.id, parsed.data);
  return NextResponse.json({ ok: true });
}
