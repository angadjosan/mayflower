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
