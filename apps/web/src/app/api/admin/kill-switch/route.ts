import { NextResponse } from "next/server";
import { apiUser, isResponse, jsonError } from "@/server/session";
import { setGlobalTrading } from "@/server/execution";

function isAdmin(handle: string | null): boolean {
  const admins = (process.env.ADMIN_HANDLES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return Boolean(handle && admins.includes(handle));
}

/** Global kill switch: stops all order submission for every user. Admins only (ADMIN_HANDLES). */
export async function POST(req: Request) {
  const user = await apiUser();
  if (isResponse(user)) return user;
  if (!isAdmin(user.imessageHandle)) return jsonError("Admins only.", 403);
  const body = (await req.json().catch(() => ({}))) as { enabled?: boolean };
  await setGlobalTrading(Boolean(body.enabled), user.id);
  return NextResponse.json({ ok: true, enabled: Boolean(body.enabled) });
}
