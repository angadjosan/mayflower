// BlueBubbles REST client (iMessage bridge). Docs: POST /api/v1/message/text?password=...
import crypto from "crypto";

const URL_ = process.env.BLUEBUBBLES_URL?.replace(/\/$/, "");
const PASSWORD = process.env.BLUEBUBBLES_PASSWORD;

export const bbEnabled = Boolean(URL_ && PASSWORD);

export async function sendIMessage(handle: string, text: string): Promise<boolean> {
  if (!handle) return false;
  return sendToChat(`iMessage;-;${handle}`, text);
}

/** Send to any chat guid — a 1:1 chat ("iMessage;-;<handle>") or a group ("iMessage;+;chat…"). */
export async function sendToChat(chatGuid: string, text: string): Promise<boolean> {
  if (!bbEnabled || !chatGuid) return false;
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
      },
    );
    if (!res.ok) {
      console.error("[bluebubbles] send failed", res.status, await res.text().catch(() => ""));
      return false;
    }
    return true;
  } catch (e) {
    console.error("[bluebubbles] send error", e);
    return false;
  }
}
