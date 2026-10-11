// BlueBubbles REST client (iMessage bridge). Docs: POST /api/v1/message/text?password=...
import crypto from "crypto";

const URL_ = process.env.BLUEBUBBLES_URL?.replace(/\/$/, "");
const PASSWORD = process.env.BLUEBUBBLES_PASSWORD;

export const bbEnabled = Boolean(URL_ && PASSWORD);

// macOS 26 (Tahoe) stores 1:1 chats as `any;-;<handle>`. Sending to `iMessage;-;` there still
// delivers but the request hangs until timeout, so try `any;-;` first. Only a definite error
// response falls through to the next guid; a timeout may have delivered, so it is not retried.
export async function sendIMessage(handle: string, text: string): Promise<boolean> {
  if (!handle) return false;
  for (const guid of [`any;-;${handle}`, `iMessage;-;${handle}`]) {
    const r = await post(guid, text);
    if (r === "ok") return true;
    if (r === "timeout") return false;
  }
  return false;
}

/** Send to any chat guid — a 1:1 chat ("iMessage;-;<handle>") or a group ("iMessage;+;chat…"). */
export async function sendToChat(chatGuid: string, text: string): Promise<boolean> {
  if (!bbEnabled || !chatGuid) return false;
  return (await post(chatGuid, text)) === "ok";
}

async function post(chatGuid: string, text: string): Promise<"ok" | "error" | "timeout"> {
  try {
    const res = await fetch(
      `${URL_}/api/v1/message/text?password=${encodeURIComponent(PASSWORD!)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatGuid,
          message: text,
          method: "apple-script",
          tempGuid: `temp-${crypto.randomUUID()}`,
        }),
        signal: AbortSignal.timeout(20_000),
      },
    );
    const raw = await res.text().catch(() => "");
    // BlueBubbles can answer HTTP 200 with an error envelope
    let env: { status?: number; error?: unknown } = {};
    try { env = JSON.parse(raw); } catch { /* non-JSON body */ }
    if (res.ok && !env.error && (env.status === undefined || env.status < 400)) return "ok";
    console.error("[bluebubbles] send failed", chatGuid.split(";")[0], res.status, raw.slice(0, 300));
    return "error";
  } catch (e) {
    console.error("[bluebubbles] send error", e);
    return (e as Error)?.name === "TimeoutError" ? "timeout" : "error";
  }
}

/** Send a file (e.g. the Mayflower contact card) to a 1:1 chat. Same guid fallback as sendIMessage. */
export async function sendAttachment(handle: string, name: string, bytes: ArrayBuffer, type: string): Promise<boolean> {
  if (!bbEnabled || !handle) return false;
  for (const chatGuid of [`any;-;${handle}`, `iMessage;-;${handle}`]) {
    try {
      const form = new FormData();
      form.set("chatGuid", chatGuid);
      form.set("tempGuid", `temp-${crypto.randomUUID()}`);
      form.set("name", name);
      form.set("method", "apple-script");
      form.set("attachment", new Blob([bytes], { type }), name);
      const res = await fetch(`${URL_}/api/v1/message/attachment?password=${encodeURIComponent(PASSWORD!)}`, {
        method: "POST", body: form, signal: AbortSignal.timeout(60_000),
      });
      const env = (await res.json().catch(() => ({}))) as { status?: number; error?: unknown };
      if (res.ok && !env.error) return true;
      console.error("[bluebubbles] attachment failed", chatGuid.split(";")[0], res.status, JSON.stringify(env).slice(0, 200));
    } catch (e) {
      console.error("[bluebubbles] attachment error", e);
      if ((e as Error)?.name === "TimeoutError") return false; // may have delivered; don't double-send
    }
  }
  return false;
}

/** Image formats Claude accepts, sniffed from magic bytes (iPhone photos may be HEIC, which it doesn't). */
export function sniffImageType(b: Uint8Array): "image/jpeg" | "image/png" | "image/gif" | "image/webp" | "image/heic" | undefined {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  const brand = String.fromCharCode(...b.slice(4, 12));
  if (/^ftyp(heic|heix|mif1|msf1|hevc)/.test(brand)) return "image/heic";
  return undefined;
}

/** Download an inbound attachment's bytes from BlueBubbles. Null when the bridge isn't configured or it fails. */
export async function downloadAttachment(guid: string, maxBytes = 8 * 1024 * 1024): Promise<Uint8Array | null> {
  if (!bbEnabled || !guid) return null;
  try {
    const res = await fetch(`${URL_}/api/v1/attachment/${encodeURIComponent(guid)}/download?password=${encodeURIComponent(PASSWORD!)}`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) { console.error("[bluebubbles] attachment download failed", res.status); return null; }
    const buf = new Uint8Array(await res.arrayBuffer());
    return buf.byteLength > maxBytes ? null : buf;
  } catch (e) {
    console.error("[bluebubbles] attachment download error", (e as Error).message);
    return null;
  }
}
