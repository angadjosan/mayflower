import { tx, load, id, now } from "./db";
import type { ChatMessage } from "./types";
import { bbEnabled, sendIMessage } from "./bluebubbles";

export function storeMessage(
  userId: string,
  role: ChatMessage["role"],
  text: string,
  channel: ChatMessage["channel"],
  groupId?: string,
): ChatMessage {
  const m: ChatMessage = { id: id("msg_"), userId, role, text, channel, createdAt: now(), ...(groupId ? { groupId } : {}) };
  tx((db) => { db.messages.push(m); });
  return m;
}

/** Store an agent message and deliver it over iMessage when the user has a handle. */
export async function sendToUser(userId: string, text: string): Promise<void> {
  const user = load().users.find((u) => u.id === userId);
  const viaIMessage = Boolean(user?.handle && bbEnabled);
  storeMessage(userId, "agent", text, viaIMessage ? "imessage" : "web");
  if (user?.handle) await sendIMessage(user.handle, text);
}
