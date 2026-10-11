import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { encryptSecret } from "@mayflower/db";
import { newId } from "@mayflower/shared";
import { getContainer } from "@/lib/container";
import { getCurrentUser } from "@/lib/user";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code"), state = url.searchParams.get("state");
  const jar = await cookies();
  if (!code || !state || state !== jar.get("mf_oauth_state")?.value) return NextResponse.json({ error: "invalid state" }, { status: 400 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/", url));
  const sandbox = (process.env.MAYFLOWER_EXCHANGE_MODE ?? "simulated") !== "live";
  const tokenRes = await fetch(sandbox ? "https://exchange.sandbox.gemini.com/auth/token" : "https://exchange.gemini.com/auth/token", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grant_type: "authorization_code", code, client_id: process.env.GEMINI_OAUTH_CLIENT_ID, client_secret: process.env.GEMINI_OAUTH_CLIENT_SECRET, redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/api/exchange/oauth/callback` }),
  });
  if (!tokenRes.ok) return NextResponse.json({ error: "token exchange failed", detail: await tokenRes.text() }, { status: 502 });
  const tok = (await tokenRes.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
  const c = getContainer();
  // Opening: refresh-token rotation job. Access tokens last ~24h.
  await c.repo.saveExchangeConnection({ id: newId(), userId: user.id, provider: "gemini", kind: "oauth", roles: ["trader"], status: "active", linkedAt: new Date().toISOString(), encryptedCredentials: encryptSecret(JSON.stringify({ kind: "oauth", accessToken: tok.access_token, refreshToken: tok.refresh_token, expiresAt: Date.now() + (tok.expires_in ?? 86400) * 1000 })) });
  await c.repo.audit({ userId: user.id, actor: "user", action: "exchange.linked", payload: { kind: "oauth", roles: ["trader"] } });
  return NextResponse.redirect(new URL("/settings?linked=1", url));
}
