import { NextResponse } from "next/server";
import { sessionUserId } from "@/lib/session";
import { audit } from "@/lib/db";
import { isContextProvider, providers, saveConnection, syncSource, verifyState } from "@/lib/connectors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const url = new URL(req.url);
  const home = (q: string) => NextResponse.redirect(new URL(`/?${q}`, req.url));
  if (!isContextProvider(provider)) return home("connect_error=unknown+provider");

  const err = url.searchParams.get("error");
  if (err) return home(`connect_error=${encodeURIComponent(`${provider}: ${err}`)}`);

  const state = verifyState(url.searchParams.get("state"), provider);
  const userId = await sessionUserId();
  if (!userId) return NextResponse.redirect(new URL("/login", process.env.APP_URL || "http://localhost:3000"));
  if (!state || state.userId !== userId) return home(`connect_error=${provider}+link+expired+or+invalid`);

  const code = url.searchParams.get("code");
  if (!code) return home(`connect_error=${provider}+missing+code`);

  try {
    const conn = await providers[provider].exchangeCode(code);
    const src = saveConnection(userId, provider, conn);
    await syncSource(src.id);
  } catch (e) {
    audit({ userId, actor: "system", action: "connector.connect_error", detail: { provider, error: e instanceof Error ? e.message.slice(0, 300) : "unknown" } });
    return home(`connect_error=${provider}+connection+failed`);
  }
  return home(`connected=${provider}`);
}
