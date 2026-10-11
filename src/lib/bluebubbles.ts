// BlueBubbles REST client (iMessage bridge). Docs: POST /api/v1/message/text?password=...
import crypto from "crypto";

const URL_ = process.env.BLUEBUBBLES_URL?.replace(/\/$/, "");
const PASSWORD = process.env.BLUEBUBBLES_PASSWORD;

export const bbEnabled = Boolean(URL_ && PASSWORD);

const api = (path: string) => `${URL_}${path}${path.includes("?") ? "&" : "?"}password=${encodeURIComponent(PASSWORD!)}`;

export type SendResult = "ok" | "error" | "timeout";

/** Error text safe to log: the BlueBubbles password rides in the query string. */
const redact = (e: unknown) => String((e as Error)?.stack ?? e).replace(/password=[^&\s"]+/g, "password=<redacted>");

// macOS 26 (Tahoe) stores 1:1 chats as `any;-;<handle>`. Sending to `iMessage;-;` there still
// delivers but the request hangs until timeout, so try `any;-;` first. Only a definite error
// response falls through to the next guid; a timeout may have delivered, so it is not retried.
async function toHandle(handle: string, send: (chatGuid: string) => Promise<SendResult>): Promise<SendResult> {
  if (!handle) return "error";
  for (const guid of [`any;-;${handle}`, `iMessage;-;${handle}`]) {
    const r = await send(guid);
    if (r !== "error") return r;
  }
  return "error";
}

export async function sendIMessage(handle: string, text: string): Promise<boolean> {
  return (await toHandle(handle, (guid) => post(guid, text))) === "ok";
}

/** Send to any chat guid — a 1:1 chat ("iMessage;-;<handle>") or a group ("iMessage;+;chat…"). */
export async function sendToChat(chatGuid: string, text: string): Promise<boolean> {
  if (!bbEnabled || !chatGuid) return false;
  return (await post(chatGuid, text)) === "ok";
}

/**
 * Send an audio file to a 1:1 chat. Without the Private API it arrives as a playable audio
 * attachment, not iMessage's native voice-memo bubble. A timed-out send is checked against the
 * chat history, so "ok" means it is really there and "error" means it is safe to fall back to text.
 */
export async function sendAudio(handle: string, audio: Buffer, filename: string): Promise<"ok" | "error"> {
  if (!bbEnabled) return "error";
  const r = await toHandle(handle, async (chatGuid) => {
    const startedAt = Date.now();
    const form = new FormData();
    form.append("chatGuid", chatGuid);
    form.append("tempGuid", `temp-${crypto.randomUUID()}`);
    form.append("name", filename);
    form.append("method", "apple-script");
    form.append("attachment", new Blob([new Uint8Array(audio)], { type: "audio/mpeg" }), filename);
    const sent = await request("/api/v1/message/attachment", { method: "POST", body: form }, 45_000, chatGuid);
    if (sent !== "timeout") return sent;
    return (await sentAttachmentSince(chatGuid, filename, startedAt - 5_000)) ? "ok" : "timeout";
  });
  return r === "ok" ? "ok" : "error";
}

/** Did we send an attachment with this name to the chat since `since` (epoch ms)? */
async function sentAttachmentSince(chatGuid: string, filename: string, since: number): Promise<boolean> {
  try {
    const res = await fetch(
      api(`/api/v1/chat/${encodeURIComponent(chatGuid)}/message?limit=10&sort=DESC&with=attachment&after=${since}`),
      { signal: AbortSignal.timeout(10_000) },
    );
    const body = (await res.json()) as { data?: { isFromMe?: boolean; attachments?: { transferName?: string }[] }[] };
    return Boolean(body.data?.some((m) => m.isFromMe && m.attachments?.some((a) => a.transferName === filename)));
  } catch (e) {
    console.error("[bluebubbles] sent-attachment check failed", redact(e));
    return false;
  }
}

export interface BBAttachment {
  guid?: string;
  uti?: string;
  mimeType?: string | null;
  transferName?: string;
}

/**
 * An iMessage voice memo: a CAF file (uti com.apple.coreaudio-format), even though BlueBubbles
 * relabels it audio/mp3. Other audio files (songs, clips) are not treated as someone talking to us.
 */
export function isVoiceMemo(a: BBAttachment): boolean {
  return a.uti === "com.apple.coreaudio-format";
}

/**
 * Download an attachment. For voice memos BlueBubbles converts the CAF to AAC in an .m4a container
 * (it labels it audio/mp3, measured 2026-10-11), which speech-to-text accepts. The webhook can fire
 * before the file is on disk, so retry briefly. Files over maxBytes come back as "too_big".
 */
export async function downloadAttachment(
  guid: string,
  maxBytes: number,
): Promise<{ data: Buffer; filename: string; mime: string } | "too_big" | null> {
  if (!bbEnabled || !guid) return null;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 1500 * attempt));
    try {
      const res = await fetch(api(`/api/v1/attachment/${encodeURIComponent(guid)}/download`), { signal: AbortSignal.timeout(10_000) });
      // BlueBubbles can answer 200 with a JSON error while the file is still transferring.
      if (!res.ok || res.headers.get("content-type")?.includes("json")) continue;
      // BlueBubbles sends no Content-Length, so stop reading once the file passes the cap.
      const data = await readCapped(res, maxBytes);
      if (data === "too_big") return "too_big";
      if (!data.length) continue;
      const mime = res.headers.get("content-type") ?? "";
      // An ISO-BMFF file ("ftyp" at byte 4) is m4a whatever the header says.
      const isM4a = data.subarray(4, 8).toString("latin1") === "ftyp";
      return isM4a
        ? { data, filename: "voice.m4a", mime: "audio/mp4" }
        : { data, filename: mime.includes("caf") ? "voice.caf" : "voice.mp3", mime: mime || "application/octet-stream" };
    } catch (e) {
      console.error("[bluebubbles] attachment download error", redact(e));
    }
  }
  return null;
}

async function readCapped(res: Response, maxBytes: number): Promise<Buffer | "too_big"> {
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return Buffer.concat(chunks);
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return "too_big";
    }
    chunks.push(value);
  }
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
    console.error("[bluebubbles] send error", path, redact(e));
    const err = e as Error & { cause?: { name?: string } };
    return err?.name === "TimeoutError" || err?.cause?.name === "TimeoutError" ? "timeout" : "error";
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

/** A picture someone sent (screenshot, photo of an article or chat). HEIC counts; the caller sniffs the real type. */
export function isImageAttachment(a: BBAttachment): boolean {
  if (a.mimeType?.startsWith("image/")) return true;
  if (a.uti && /^public\.(jpeg|png|heic|heif)$|^com\.compuserve\.gif$|^org\.webmproject\.webp$/.test(a.uti)) return true;
  return /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(a.transferName ?? "");
}
