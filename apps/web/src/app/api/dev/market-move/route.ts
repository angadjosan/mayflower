import { NextResponse } from "next/server";
import { shiftDemoPrice } from "@mayflower/gemini-markets";
import { pushDemoNews } from "@mayflower/context";
import { config } from "@/server/config";
import { apiUser, isResponse, jsonError } from "@/server/session";
import { getMarketRow } from "@/server/markets";
import { audit } from "@/server/audit";

/** DEMO MODE ONLY: move a demo contract's price and inject a demo news item to exercise monitoring. */
export async function POST(req: Request) {
  if (!config().demoMode) return jsonError("Only available in demo mode.", 403);
  const user = await apiUser();
  if (isResponse(user)) return user;
  const body = (await req.json().catch(() => ({}))) as { symbol?: string; delta?: number; headline?: string };
  if (!body.symbol || typeof body.delta !== "number") return jsonError("symbol and delta required");
  const m = await getMarketRow(body.symbol);
  if (!m || m.source !== "demo") return jsonError("Unknown demo contract.");
  shiftDemoPrice(body.symbol, Math.max(-0.5, Math.min(0.5, body.delta)));
  if (body.headline) {
    pushDemoNews(m.eventTicker, { title: body.headline, url: "https://example.com/demo-news", snippet: `${body.headline} (simulated news for the demo; ${body.delta < 0 ? "a risk to" : "supports"} “${m.label}”).` });
  }
  await audit({ userId: user.id, actor: "user", action: "demo.market_move", details: body });
  return NextResponse.json({ ok: true });
}
