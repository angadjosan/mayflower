import { NextResponse } from "next/server";
import { currentUserId } from "@/lib/session";
import { connectUrl, isContextProvider, notionInternal, notionInternalConnection, providers, saveConnection, syncSource } from "@/lib/connectors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const home = (q: string) => NextResponse.redirect(new URL(`/?${q}`, req.url));
  if (!isContextProvider(provider)) return home("connect_error=unknown+provider");
  if (!providers[provider].configured) return home(`connect_error=${provider}+not+configured`);
  const userId = await currentUserId();

  if (provider === "notion" && notionInternal) {
    const src = saveConnection(userId, "notion", notionInternalConnection());
    await syncSource(src.id);
    return home("connected=notion");
  }
  return NextResponse.redirect(connectUrl(provider, userId));
}
