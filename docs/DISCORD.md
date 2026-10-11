# Discord

Mayflower can talk over Discord as well as iMessage. Discord DMs act like iMessage 1:1 chats, and guild
channels act like iMessage group chats, so contests, group picks, and always-listening suggestions work there too.

## How it works

- **Receiving:** Discord bots only receive messages over the Gateway (a persistent websocket), not
  webhooks. `scripts/discord-bot.mjs` keeps that connection open and forwards every non-bot message to
  `POST ${APP_URL}/api/discord/inbound` with the header `x-mayflower-secret: $DISCORD_INBOUND_SECRET`.
- **Sending:** the app replies over the Discord REST API (`src/lib/transport.ts`). Anything addressed to
  a handle or chat id that starts with `discord:` goes to Discord, and everything else goes to BlueBubbles.
  Messages longer than 2000 characters are split.
- **Identity:** a Discord user becomes the Mayflower user `discord:<discordUserId>`. Their name comes
  from their Discord display name the first time they write. A guild channel becomes the group
  `discord:<channelId>`.
- In the MVP, the first handle that writes in (iMessage or Discord) is attached to the demo web user.

## Setup

1. Go to <https://discord.com/developers/applications> and choose **New Application**. The
   **Application ID** on the General Information page is your `DISCORD_CLIENT_ID`.
2. Open **Bot** and choose **Reset Token**. Copy the token into `DISCORD_BOT_TOKEN`.
3. On the same **Bot** page, under *Privileged Gateway Intents*, turn on **MESSAGE CONTENT INTENT**.
   Without it the bot receives empty message text.
4. Add the bot to your server with this URL (replace `<ID>` with the client id):

   ```
   https://discord.com/oauth2/authorize?client_id=<ID>&scope=bot&permissions=274877975552
   ```

   This grants View Channels, Send Messages, and Read Message History.
5. Add these to `.env.local`:

   ```
   DISCORD_BOT_TOKEN=...
   DISCORD_CLIENT_ID=...
   DISCORD_INBOUND_SECRET=<any long random string, e.g. `openssl rand -hex 24`>
   APP_URL=http://localhost:3000   # where the bot forwards messages
   ```

6. Run both processes:

   ```
   npm run dev       # the Next.js app
   npm run discord   # the Gateway bot (reads .env.local itself)
   ```

## Using it

- **DM the bot** and it works like the iMessage copilot: research, proposals, and approval links.
- **In a channel**, the bot reads every message (always listening) and occasionally suggests a group
  pick when the chat turns to something tradeable. Mention it (`@Mayflower`) or say "Mayflower" to
  address it directly.

### Contests in a channel

```
@Mayflower start a contest, $10 each, 1 week, loser buys dinner
```

Then each member pitches a pick:

```
my pick: bitcoin above 83000 by Friday
```

Other commands: `@Mayflower leaderboard`, `@Mayflower end the contest`, `@Mayflower what should we bet on?`.
Members join a group pick by replying "I'm in". Approval links are always sent by DM, never posted in
the channel.

## Notes

- Messages are stored with channel `"imessage"`, because `ChatMessage.channel` has no `"discord"` value.
- If `DISCORD_BOT_TOKEN` is missing on the app side, sends are logged as errors and skipped. They never throw.
