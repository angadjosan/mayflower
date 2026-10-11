// BlueBubbles REST client (iMessage bridge). Docs: POST /api/v1/message/text?password=...
import crypto from "crypto";

const URL_ = process.env.BLUEBUBBLES_URL?.replace(/\/$/, "");
const PASSWORD = process.env.BLUEBUBBLES_PASSWORD;

export const bbEnabled = Boolean(URL_ && PASSWORD);

const api = (path: string) => `${URL_}${path}${path.includes("?") ? "&" : "?"}password=${encodeURIComponent(PASSWORD!)}`;

type SendResult = "ok" | "error" | "timeout";

// macOS 26 (Tahoe) stores 1:1 chats as `any;-;<handle>`. Sending to `iMessage;-;` there still
// delivers but the request hangs until timeout, so try `any;-;` first. Only a definite error
// response falls through to the next guid; a timeout may have delivered, so it is not retried.
async function toHandle(handle: string, send: (chatGuid: string) => Promise<SendResult>): Promise<boolean> {
  if (!handle) return false;
  for (const guid of [`any;-;${handle}`, `iMessage;-;${handle}`]) {
    const r = await send(guid);
    if (r === "ok") return true;
    if (r === "timeout") return false;
  }
  return false;
}

export async function sendIMessage(handle: string, text: string): Promise<boolean> {
  return toHandle(handle, (guid) => post(guid, text));
}

/** Send to any chat guid — a 1:1 chat ("iMessage;-;<handle>") or a group ("iMessage;+;chat…"). */
export async function sendToChat(chatGuid: string, text: string): Promise<boolean> {
  if (!bbEnabled || !chatGuid) return false;
  return (await post(chatGuid, text)) === "ok";
}

/**
 * Send an audio file to a 1:1 chat. Without the Private API it arrives as a playable audio
 * attachment, not iMessage's native voice-memo bubble.
 */
export async function sendAudio(handle: string, audio: Buffer, filename: string): Promise<boolean> {
  if (!bbEnabled) return false;
  return toHandle(handle, async (chatGuid) => {
    const form = new FormData();
    form.append("chatGuid", chatGuid);
    form.append("tempGuid", `temp-${crypto.randomUUID()}`);
    form.append("name", filename);
    form.append("method", "apple-script");
    form.append("attachment", new Blob([new Uint8Array(audio)], { type: "audio/mpeg" }), filename);
    return request("/api/v1/message/attachment", { method: "POST", body: form }, 45_000, chatGuid);
  });
}

export interface BBAttachment {
  guid?: string;
  uti?: string;
  mimeType?: string | null;
  transferName?: string;
}

/** iMessage voice memos are CAF files (uti com.apple.coreaudio-format); BlueBubbles may relabel them audio/mp3. */
export function isAudioAttachment(a: BBAttachment): boolean {
  return a.uti === "com.apple.coreaudio-format" || Boolean(a.mimeType?.startsWith("audio/")) || /\.(caf|m4a|mp3|wav|aac)$/i.test(a.transferName ?? "");
}

/**
 * Download an attachment. For voice memos BlueBubbles converts the CAF to AAC in an .m4a container
 * (it labels it audio/mp3, measured 2026-10-11), which speech-to-text accepts. The webhook can fire
 * before the file is on disk, so retry briefly.
 */
export async function downloadAttachment(guid: string): Promise<{ data: Buffer; filename: string; mime: string } | null> {
  if (!bbEnabled || !guid) return null;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 1500 * attempt));
    try {
      const res = await fetch(api(`/api/v1/attachment/${encodeURIComponent(guid)}/download`), { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) continue;
      const data = Buffer.from(await res.arrayBuffer());
      if (!data.length) continue;
      const mime = res.headers.get("content-type") ?? "";
      // An ISO-BMFF file ("ftyp" at byte 4) is m4a whatever the header says.
      const isM4a = data.subarray(4, 8).toString("latin1") === "ftyp";
      return isM4a
        ? { data, filename: "voice.m4a", mime: "audio/mp4" }
        : { data, filename: mime.includes("caf") ? "voice.caf" : "voice.mp3", mime: mime || "application/octet-stream" };
    } catch (e) {
      console.error("[bluebubbles] attachment download error", e);
    }
  }
  return null;
}

async function post(chatGuid: string, text: string): Promise<SendResult> {
  return request(
    "/api/v1/message/text",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatGuid, message: text, method: "apple-script", tempGuid: `temp-${crypto.randomUUID()}` }),
    },
    20_000,
    chatGuid,
  );
}

async function request(path: string, init: RequestInit, timeoutMs: number, chatGuid: string): Promise<SendResult> {
  try {
    const res = await fetch(api(path), { ...init, signal: AbortSignal.timeout(timeoutMs) });
    const raw = await res.text().catch(() => "");
    // BlueBubbles can answer HTTP 200 with an error envelope
    let env: { status?: number; error?: unknown } = {};
    try { env = JSON.parse(raw); } catch { /* non-JSON body */ }
    if (res.ok && !env.error && (env.status === undefined || env.status < 400)) return "ok";
    console.error("[bluebubbles] send failed", path, chatGuid.split(";")[0], res.status, raw.slice(0, 300));
    return "error";
  } catch (e) {
    console.error("[bluebubbles] send error", path, e);
    return (e as Error)?.name === "TimeoutError" ? "timeout" : "error";
  }
}
