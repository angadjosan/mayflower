import { NextResponse } from "next/server";
import { getOrCreateUser, tx } from "@/lib/db";
import { storeMessage, sendToUser } from "@/lib/notify";
import { handleMessage } from "@/lib/agent/chat";
import { handleGroupMessage } from "@/lib/agent/group";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Payload forwarded by scripts/discord-bot.mjs (the Discord Gateway client). */
interface DiscordInbound {
  kind?: "dm" | "channel";
  channelId?: string;
  authorId?: string;
  authorName?: string;
  text?: string;
  mentioned?: boolean;
}

/** Resolve the Mayflower user for a Discord author, naming them on first contact. */
async function discordUser(authorId: string, authorName?: string) {
  const user = await getOrCreateUser({ handle: `discord:${authorId}` });
  const name = authorName?.trim();
  if (!user.name && name) {
    await tx((db) => {
      const u = db.users.find((x) => x.id === user.id);
      if (u && !u.name) u.name = name.slice(0, 64);
    });
  }
  return user;
}

export async function POST(req: Request) {
  const secret = process.env.DISCORD_INBOUND_SECRET;
  // Fail closed: this endpoint creates users and runs the agent.
  if (!secret || req.headers.get("x-mayflower-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as DiscordInbound;
  const text = body.text?.trim();
  const { kind, channelId, authorId } = body;
  if (!text || !authorId || !channelId || (kind !== "dm" && kind !== "channel")) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  if (kind === "channel") {
    await discordUser(authorId, body.authorName);
    try {
      await handleGroupMessage(`discord:${channelId}`, `discord:${authorId}`, body.mentioned ? `Mayflower ${text}` : text);
    } catch (e) {
      console.error("[discord group]", e);
    }
    return NextResponse.json({ ok: true, group: true });
  }

  const user = await discordUser(authorId, body.authorName);
  // ChatMessage.channel has no "discord" value; Discord DMs are stored as "imessage" (messaging surface).
  await storeMessage(user.id, "user", text, "imessage");
  let reply: string;
  try {
    reply = await handleMessage(user.id, text, "imessage");
  } catch (e) {
    console.error("[discord dm]", e);
    reply = "Sorry — something went wrong on my end. Try again in a moment.";
  }
  await sendToUser(user.id, reply);
  return NextResponse.json({ ok: true });
}
