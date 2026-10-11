import { tx, load, id, now } from "./db";
import type { ChatMessage } from "./types";
import { sendDirect, transportEnabled } from "./transport";
import { casual, deDash } from "./textStyle";

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

/** Store an agent message and deliver it over iMessage or Discord when the user has a handle. */
export async function sendToUser(userId: string, raw: string): Promise<void> {
  const text = casual(deDash(raw));
  const user = (await load()).users.find((u) => u.id === userId);
  // ChatMessage.channel has no "discord" value; messaging-surface deliveries (iMessage or Discord) are stored as "imessage".
  const viaChat = transportEnabled(user?.handle);
  await storeMessage(userId, "agent", text, viaChat ? "imessage" : "web");
  if (user?.handle) await sendDirect(user.handle, text);
}
