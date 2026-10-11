# Local texts reader (optional, Mac only)

Most people should just **forward texts or screenshots to Mayflower** in iMessage. That works from your phone.
This script is an optional extra for Mac users. It learns your interests from the messages you've sent, without uploading those messages.

## Run

```sh
node scripts/local-texts/index.mjs --dry-run                     # prints what would be uploaded, sends nothing to Mayflower
MAYFLOWER_URL=https://your-app MAYFLOWER_UPLOAD_TOKEN=mfu_... node scripts/local-texts/index.mjs
```

It needs Node 18+, the `sqlite3` that ships with macOS, and `ANTHROPIC_API_KEY` (from your environment or `.env.local`).
To get the URL and token, text Mayflower "set up my texts". It sends a sign-in link to a page with the exact command.
Flags: `--days 90` (how far back to read), `--max 3000` (number of messages), `--batches 5` (number of Claude calls), `--db <path>`.

## Full Disk Access

macOS keeps `~/Library/Messages/chat.db` behind Full Disk Access. If you see "Can't read your Messages database":
System Settings > Privacy & Security > Full Disk Access, turn it on for Terminal (or iTerm or your editor), then quit and reopen that app.
You can turn it off again afterwards. The script opens the database read-only (`sqlite3 -readonly`).

## What leaves your Mac

- **To Claude (Anthropic API, using your own key):** the messages *you* sent in the last N days, with phone numbers, emails and links removed. Nothing anyone else sent is included.
- **To Mayflower:** at most 40 short items such as `{"kind":"belief","topic":"Fed","text":"Expects the Fed to cut in December","excerpt":"i think the fed cuts again"}`.
  Excerpts are your own words, up to 150 characters. Items that mention health, relationships, money troubles, phone numbers or emails are dropped on your Mac before upload. Use `--dry-run` to see the exact payload.

Each upload replaces the previous one.

## Revoke

Text Mayflower "forget my texts". That revokes the token and deletes everything it uploaded.
You can also call `DELETE /api/ingest/token?purge=1` while signed in. Opening the token page again replaces the old token.
