import { tx, load, id, now } from "./db";
import type { ChatMessage } from "./types";
import { isDiscord, sendDirect, transportEnabled } from "./transport";
import { casual, deDash } from "./textStyle";
import { sendAudio } from "./bluebubbles";
import { elevenEnabled, synthesize } from "./elevenlabs";
import { planReply } from "./voiceNotes";

export async function storeMessage(
  userId: string,
  role: ChatMessage["role"],
  text: string,
  channel: ChatMessage["channel"],
  groupId?: string,
): Promise<ChatMessage> {
  const m: ChatMessage = { id: id("msg_"), userId, role, text, channel, createdAt: now(), ...(groupId ? { groupId } : {}) };
  await tx((db) => { db.messages.push(m); });
  return m;
}

/**
 * Store an agent message and deliver it over iMessage or Discord when the user has a handle.
 * voiceIn/askedForVoice: the user is talking to us, so a conversational reply goes out as an
 * iMessage voice note (links and codes still follow as texts). Any voice failure falls back to text.
 */
export async function sendToUser(userId: string, raw: string, opts: { voiceIn?: boolean; askedForVoice?: boolean } = {}): Promise<void> {
  const text = casual(deDash(raw));
  const user = (await load()).users.find((u) => u.id === userId);
  // ChatMessage.channel has no "discord" value; messaging-surface deliveries (iMessage or Discord) are stored as "imessage".
  const viaChat = transportEnabled(user?.handle);
  await storeMessage(userId, "agent", text, viaChat ? "imessage" : "web");
  if (!user?.handle) return;
  if (viaChat && !isDiscord(user.handle) && elevenEnabled()) {
    const plan = planReply(raw, opts);
    if (plan.speak && (await sendVoiceNote(user.handle, plan.speak))) {
      if (plan.text) await sendDirect(user.handle, casual(deDash(plan.text)));
      return;
    }
  }
  await sendDirect(user.handle, text);
}

async function sendVoiceNote(handle: string, speech: string): Promise<boolean> {
  try {
    return await sendAudio(handle, await synthesize(speech), "mayflower.mp3");
  } catch (e) {
    console.error("[voice note]", e);
    return false;
  }
}
