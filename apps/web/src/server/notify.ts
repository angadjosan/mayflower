import { blueBubblesConfigured } from "./config";
import { getDb, schema } from "./db/client";
import type { Message, User } from "./db/schema";
import { sendIMessage } from "./bluebubbles";

/**
 * Deliver an assistant message. iMessage (BlueBubbles) is the primary channel;
 * every message is also stored so the web chat mirrors the conversation and
 * works as a fallback when the bridge is down.
 */
export async function sendToUser(
  user: Pick<User, "id" | "imessageHandle">,
  text: string,
  opts: { channel?: "auto" | "web" | "imessage"; meta?: Record<string, unknown> } = {},
): Promise<Message> {
  const db = await getDb();
  const wantIMessage = opts.channel !== "web" && Boolean(user.imessageHandle) && blueBubblesConfigured();
  let delivery = "web_only";
  let channel: "web" | "imessage" = "web";
  if (wantIMessage && user.imessageHandle) {
    const res = await sendIMessage(user.imessageHandle, text);
    channel = "imessage";
    delivery = res.ok ? "sent" : `failed: ${res.error ?? "unknown"}`;
  }
  const [row] = await db
    .insert(schema.messages)
    .values({ userId: user.id, role: "assistant", channel, text, delivery, meta: opts.meta ?? null })
    .returning();
  return row;
}

export async function recordUserMessage(userId: string, text: string, channel: "web" | "imessage", externalGuid?: string): Promise<Message | null> {
  const db = await getDb();
  const rows = await db
    .insert(schema.messages)
    .values({ userId, role: "user", channel, text, externalGuid: externalGuid ?? null })
    .onConflictDoNothing({ target: schema.messages.externalGuid })
    .returning();
  return rows[0] ?? null;
}
