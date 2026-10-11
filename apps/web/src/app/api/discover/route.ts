import { NextResponse } from "next/server";
import { apiUser, isResponse } from "@/server/session";
import { runDiscovery } from "@/server/pipeline";

export const maxDuration = 120;

export async function POST(req: Request) {
  const user = await apiUser();
  if (isResponse(user)) return user;
  const body = (await req.json().catch(() => ({}))) as { focus?: string | null };
  const r = await runDiscovery(user.id, { trigger: "user_request", focus: body.focus || null, maxPersonalized: 1, maxGeneral: 1 });
  const trades = r.analyzed.filter((a) => a.sizing.decision === "trade").length;
  const summary = r.analyzed.length
    ? `Scanned ${r.scanned} contracts: ${trades} trade idea${trades === 1 ? "" : "s"}, ${r.analyzed.length - trades} no-trade.`
    : r.errors[0] ?? "Nothing worth recommending right now.";
  return NextResponse.json({ summary, errors: r.errors });
}
