import { NextResponse } from "next/server";
import { sessionUserId, UNAUTHORIZED } from "@/lib/session";
import { deleteLocalTexts, mintUploadToken, revokeUploadToken } from "@/lib/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const APP_URL = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/**
 * Signed-in: mint a fresh upload token for the optional Mac local-texts reader (replaces any previous one).
 * Browsers get a small page with the one command to run; API clients get JSON.
 */
export async function GET(req: Request) {
  const userId = await sessionUserId();
  if (!userId) return NextResponse.json(UNAUTHORIZED, { status: 401 });
  const token = await mintUploadToken(userId);
  const cmd = `MAYFLOWER_URL=${APP_URL} MAYFLOWER_UPLOAD_TOKEN=${token} node scripts/local-texts/index.mjs`;
  if (!(req.headers.get("accept") ?? "").includes("text/html")) {
    return NextResponse.json({ token, url: APP_URL, command: cmd, revoke: "DELETE /api/ingest/token" }, { headers: { "Cache-Control": "no-store" } });
  }
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mayflower local texts</title>
<body style="font:15px/1.5 system-ui;max-width:640px;margin:40px auto;padding:0 16px;background:#fff;color:#111">
<h2>Optional: learn from your own texts (Mac)</h2>
<p>This token lets the local reader upload what it learned. It runs on your Mac, reads only messages <b>you</b> sent, and uploads only short interests/opinions, never your messages or anyone's contacts. Treat the token like a password.</p>
<p>Try it first without uploading anything:</p>
<pre style="white-space:pre-wrap;word-break:break-all;background:#f3f3f3;padding:12px;border-radius:8px">node scripts/local-texts/index.mjs --dry-run</pre>
<p>Then upload:</p>
<pre style="white-space:pre-wrap;word-break:break-all;background:#f3f3f3;padding:12px;border-radius:8px">${esc(cmd)}</pre>
<p>Opening this page again replaces the token. To revoke it, and delete everything it uploaded, text Mayflower "forget my texts" or send <code>DELETE /api/ingest/token?purge=1</code>.</p>
</body>`;
  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

/** Revoke the upload token. `?purge=1` also deletes everything it uploaded. */
export async function DELETE(req: Request) {
  const userId = await sessionUserId();
  if (!userId) return NextResponse.json(UNAUTHORIZED, { status: 401 });
  await revokeUploadToken(userId);
  if (new URL(req.url).searchParams.get("purge") === "1") await deleteLocalTexts(userId);
  return NextResponse.json({ ok: true });
}
