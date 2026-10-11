import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
export const dynamic = "force-dynamic";

/**
 * Gemini OAuth 2.0 (authorization code). Authorize URL: https://exchange.gemini.com/auth
 * (sandbox: https://exchange.sandbox.gemini.com/auth). Scopes requested are
 * read + orders:create only — never fund movement.
 */
export async function GET() {
  const clientId = process.env.GEMINI_OAUTH_CLIENT_ID;
  if (!clientId) return NextResponse.json({ error: "GEMINI_OAUTH_CLIENT_ID not configured; use API-key linking in Settings." }, { status: 501 });
  const sandbox = (process.env.MAYFLOWER_EXCHANGE_MODE ?? "simulated") !== "live";
  const state = randomBytes(16).toString("hex");
  const u = new URL(sandbox ? "https://exchange.sandbox.gemini.com/auth" : "https://exchange.gemini.com/auth");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("redirect_uri", `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/api/exchange/oauth/callback`);
  u.searchParams.set("scope", "account:read balances:read orders:read orders:create positions:read predictions:positions:read");
  u.searchParams.set("state", state);
  const res = NextResponse.redirect(u);
  res.cookies.set("mf_oauth_state", state, { httpOnly: true, sameSite: "lax", maxAge: 600, path: "/" });
  return res;
}
