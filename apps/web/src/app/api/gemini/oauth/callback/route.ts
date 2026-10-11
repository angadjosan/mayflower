import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/session";
import { completeGeminiOAuth, markTermsAccepted, venueForConnection } from "@/server/gemini-link";
import { executeAwaitingLink } from "@/server/execution";
import { sendToUser } from "@/server/notify";

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));
  const res = await completeGeminiOAuth(user.id, req.url);
  if (!res.ok) return NextResponse.redirect(new URL("/link?error=" + encodeURIComponent(res.error), req.url));
  try {
    const terms = await venueForConnection(user.id, res.connection).termsStatus();
    if (!terms.hasAcceptedLatest) return NextResponse.redirect(new URL("/link?terms=1", req.url));
    await markTermsAccepted(res.connection.id);
  } catch {
    return NextResponse.redirect(new URL("/link?terms=1", req.url));
  }
  const results = await executeAwaitingLink(user.id);
  for (const r of results) await sendToUser(user, r.message);
  return NextResponse.redirect(new URL(`/link?linked=1${results.length ? `&submitted=${results.length}` : ""}`, req.url));
}
