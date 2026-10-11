// Outbound transport dispatch: Discord (handles/chat ids prefixed "discord:") or BlueBubbles (iMessage).
import { bbEnabled, sendIMessage, sendToChat as bbSendToChat } from "./bluebubbles";
import { BUBBLE_GAP_MS, deDash, toBubbles } from "./textStyle";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Send each line as its own text, in order, with a short typing gap. */
async function sendBubbles(send: (t: string) => Promise<boolean>, text: string): Promise<boolean> {
  const bubbles = toBubbles(text);
  let ok = bubbles.length > 0;
  for (const [i, b] of bubbles.entries()) {
    if (i) await sleep(BUBBLE_GAP_MS);
    if (!(await send(b))) { ok = false; break; }
  }
  return ok;
}

const DISCORD_API = "https://discord.com/api/v10";
const DISCORD_MAX = 2000;
const PREFIX = "discord:";

export const isDiscord = (idOrHandle?: string | null) => Boolean(idOrHandle?.startsWith(PREFIX));
export const discordEnabled = () => Boolean(process.env.DISCORD_BOT_TOKEN);

/** Whether we can actually deliver to this handle right now. */
export function transportEnabled(handle?: string | null): boolean {
  if (!handle) return false;
  return isDiscord(handle) ? discordEnabled() : bbEnabled;
}

/** Split text into <=2000-char chunks, preferring newline/space boundaries. */
export function splitMessage(text: string, max = DISCORD_MAX): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n", max);
    if (cut < max / 2) cut = rest.lastIndexOf(" ", max);
    if (cut < max / 2) cut = max;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\s+/, "");
  }
  if (rest) out.push(rest);
  return out;
}

async function discordFetch(path: string, body: unknown): Promise<Record<string, unknown> | null> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    console.error("[discord] DISCORD_BOT_TOKEN not set; cannot send", path);
    return null;
  }
  try {
    const res = await fetch(`${DISCORD_API}${path}`, {
      method: "POST",
      headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error("[discord] request failed", path, res.status, await res.text().catch(() => ""));
      return null;
    }
    return (await res.json().catch(() => ({}))) as Record<string, unknown>;
  } catch (e) {
    console.error("[discord] request error", path, e);
    return null;
  }
}

async function discordSendChannel(channelId: string, text: string): Promise<boolean> {
  if (!channelId || !text) return false;
  for (const chunk of splitMessage(text)) {
    const r = await discordFetch(`/channels/${channelId}/messages`, {
      content: chunk,
      allowed_mentions: { parse: [] },
    });
    if (!r) return false;
  }
  return true;
}

const dmChannelCache = new Map<string, string>();

async function discordSendDM(userId: string, text: string): Promise<boolean> {
  let channelId = dmChannelCache.get(userId);
  if (!channelId) {
    const r = await discordFetch(`/users/@me/channels`, { recipient_id: userId });
    if (!r || typeof r.id !== "string") return false;
    channelId = r.id;
    dmChannelCache.set(userId, channelId);
  }
  return discordSendChannel(channelId, text);
}

/** Send a 1:1 message to a user handle (iMessage address or "discord:<userId>"). Never throws. */
export async function sendDirect(handle: string, text: string): Promise<boolean> {
  if (!handle) return false;
  if (isDiscord(handle)) return discordSendDM(handle.slice(PREFIX.length), deDash(text));
  return sendBubbles((t) => sendIMessage(handle, t), text);
}

/** Send into a chat/group (BlueBubbles chat guid or "discord:<channelId>"). Never throws. */
export async function sendToChat(chatId: string, text: string): Promise<boolean> {
  if (!chatId) return false;
  if (isDiscord(chatId)) return discordSendChannel(chatId.slice(PREFIX.length), deDash(text));
  return sendBubbles((t) => bbSendToChat(chatId, t), text);
}
