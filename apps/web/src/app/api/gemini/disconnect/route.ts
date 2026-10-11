import { NextResponse } from "next/server";
import { apiUser, isResponse } from "@/server/session";
import { disconnectGemini } from "@/server/gemini-link";

export async function POST() {
  const user = await apiUser();
  if (isResponse(user)) return user;
  await disconnectGemini(user.id);
  return NextResponse.json({ ok: true });
}
