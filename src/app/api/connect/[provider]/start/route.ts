import { NextResponse } from "next/server";
import { sessionUserId } from "@/lib/session";
import { load } from "@/lib/db";
import { connectUrl, isContextProvider, notionInternal, notionInternalConnection, providers, saveConnection, syncSource } from "@/lib/connectors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const home = (q: string) => NextResponse.redirect(new URL(`/?${q}`, req.url));
  if (!isContextProvider(provider)) return home("connect_error=unknown+provider");
  if (!providers[provider].configured) return home(`connect_error=${provider}+not+configured`);
  const userId = await sessionUserId();
  if (!userId) return NextResponse.redirect(new URL("/login", process.env.APP_URL || "http://localhost:3000"));

  if (provider === "notion" && notionInternal) {
    // NOTION_TOKEN is one person's workspace: only its owner (iMessage handle in NOTION_TOKEN_OWNER) may attach it.
    const norm = (h?: string) => (h ?? "").toLowerCase().replace(/[^\d+@a-z.]/g, "");
    const owner = norm(process.env.NOTION_TOKEN_OWNER);
    const me = (await load()).users.find((u) => u.id === userId);
    if (!owner || norm(me?.handle) !== owner) return home("connect_error=notion+is+not+available+for+this+account");
    const src = await saveConnection(userId, "notion", notionInternalConnection());
    await syncSource(src.id);
    return home("connected=notion");
  }
  return NextResponse.redirect(connectUrl(provider, userId));
}
