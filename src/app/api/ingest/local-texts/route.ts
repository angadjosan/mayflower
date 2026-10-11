import { NextResponse } from "next/server";
import { load } from "@/lib/db";
import { bearer, ingestLocalTexts, parseUpload, userIdForUploadToken } from "@/lib/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Upload from scripts/local-texts: extracted interests/opinions only (never raw messages). Bearer upload token. */
export async function POST(req: Request) {
  const userId = userIdForUploadToken(await load(), bearer(req.headers.get("authorization")));
  if (!userId) return NextResponse.json({ error: "invalid or revoked upload token" }, { status: 401 });
  const text = await req.text();
  if (text.length > 100_000) return NextResponse.json({ error: "payload too large" }, { status: 413 });
  let body: unknown;
  try { body = JSON.parse(text); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const items = parseUpload(body);
  if (typeof items === "string") return NextResponse.json({ error: items }, { status: 400 });
  return NextResponse.json({ ok: true, received: items.length, ...(await ingestLocalTexts(userId, items)) });
}
