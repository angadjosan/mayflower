// Mayflower Discord bot: holds the Discord Gateway websocket and forwards every
// non-bot message to the Next.js app at POST ${APP_URL}/api/discord/inbound.
// Replies are sent by the app itself over the Discord REST API (src/lib/transport.ts).
// Run alongside the app:  npm run discord
import fs from "node:fs";
import path from "node:path";
import { Client, Events, GatewayIntentBits, Partials } from "discord.js";

// Minimal .env.local / .env loader (existing process env wins).
for (const file of [".env.local", ".env"]) {
  const p = path.join(process.cwd(), file);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const SECRET = process.env.DISCORD_INBOUND_SECRET;
const APP_URL = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
if (!TOKEN) {
  console.error("[discord-bot] DISCORD_BOT_TOKEN is not set (see docs/DISCORD.md)");
  process.exit(1);
}
if (!SECRET) {
  console.error("[discord-bot] DISCORD_INBOUND_SECRET is not set (see docs/DISCORD.md)");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel], // required to receive DMs
});

client.once(Events.ClientReady, (c) => {
  console.log(`[discord-bot] logged in as ${c.user.tag}; forwarding to ${APP_URL}/api/discord/inbound`);
});

client.on(Events.MessageCreate, async (message) => {
  try {
    if (message.author.bot || message.system) return;
    const botId = client.user?.id;
    const isDM = !message.guildId;
    const mentioned = Boolean(botId && message.mentions.users.has(botId));

    // Strip the bot's own mention; render other user mentions as @name.
    let text = message.content ?? "";
    if (botId) text = text.replace(new RegExp(`<@!?${botId}>`, "g"), "");
    text = text.replace(/<@!?(\d+)>/g, (_, id) => {
      const u = message.mentions.users.get(id);
      return u ? `@${u.displayName ?? u.username}` : "@someone";
    });
    text = text.replace(/\s+/g, " ").trim();
    if (!text) return;

    if (isDM || mentioned) message.channel.sendTyping?.().catch(() => {});

    const body = {
      kind: isDM ? "dm" : "channel",
      channelId: message.channelId,
      authorId: message.author.id,
      authorName: message.member?.displayName ?? message.author.globalName ?? message.author.username,
      text,
      mentioned,
    };
    const res = await fetch(`${APP_URL}/api/discord/inbound`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-mayflower-secret": SECRET },
      body: JSON.stringify(body),
    });
    if (!res.ok) console.error("[discord-bot] inbound failed", res.status, await res.text().catch(() => ""));
  } catch (e) {
    console.error("[discord-bot] forward error", e);
  }
});

client.on(Events.Error, (e) => console.error("[discord-bot] client error", e));
process.on("SIGINT", () => { client.destroy(); process.exit(0); });

client.login(TOKEN);
