import { NextResponse } from "next/server";
import { z } from "zod";
import { apiUser, isResponse, jsonError } from "@/server/session";
import { updateProfileDirect } from "@/server/users";

const Body = z.object({
  displayName: z.string().max(60).nullable().optional(),
  riskBudget: z.coerce.number(),
  maxPerPosition: z.coerce.number(),
  maxTotalExposure: z.coerce.number(),
  riskStyle: z.enum(["conservative", "balanced", "aggressive"]),
  interests: z.array(z.string().max(80)).max(30),
  excludedTopics: z.array(z.string().max(80)).max(30),
  notifyLevel: z.enum(["important", "all", "none"]),
});

export async function POST(req: Request) {
  const user = await apiUser();
  if (isResponse(user)) return user;
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Invalid profile values.");
  const res = await updateProfileDirect(user.id, parsed.data);
  return res.ok ? NextResponse.json({ ok: true }) : jsonError(res.error);
}
