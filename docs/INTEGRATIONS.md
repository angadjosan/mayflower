# Integrations

## LLM: Claude (`src/lib/llm.ts`)
- Env: `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` (default `claude-opus-5-5`), `ANTHROPIC_EFFORT` (default `medium`; use `low` for snappier iMessage replies).
- SDK: `@anthropic-ai/sdk` `beta.messages.create` with server-side refusal fallbacks (`fallbacks: "default"`). JSON mode is enforced via the system prompt (code fences are stripped before parsing).
- Without a key: `generateText` returns a placeholder, `generateJSON` throws `LLM_DISABLED` and callers use heuristics.

## Exchange: Gemini Prediction Markets (`src/lib/exchange.ts`)
- Env: `GEMINI_EXCHANGE_API_KEY`, `GEMINI_EXCHANGE_API_SECRET`, `GEMINI_EXCHANGE_BASE_URL` (default `https://api.sandbox.gemini.com`).
- Mode: `sandbox` when key and secret are set, otherwise `simulated`.
- **Verified:** `GET /v1/prediction-markets/events?status=active&limit=100` is public and needs no auth, and it works against the sandbox. Each contract's `instrumentSymbol` is used as `Market.id`. Prices map as follows: `prices.buy.yes` → yesAsk, `prices.sell.yes` → yesBid, `prices.buy.no` → noAsk, `prices.sell.no` → noBid. Contracts with no quotes are skipped. If the call fails or returns nothing, we fall back to 13 mock markets (`source: "mock"`). Results are cached for 60s.
- **From docs, not exercised:** `POST /v1/prediction-markets/order` takes `{symbol, orderType:"limit", side, quantity, price, outcome:"yes"|"no", timeInForce}` and returns `{orderId, status: open|filled|cancelled, filledQuantity, remainingQuantity, avgExecutionPrice}`.
- Auth uses the standard Gemini scheme: `X-GEMINI-APIKEY`, `X-GEMINI-PAYLOAD` (base64 JSON with `request` and `nonce` plus the body fields), and `X-GEMINI-SIGNATURE` (hex HMAC-SHA384 of the payload).
- **Unverified (guessed):** order status uses `POST /v1/prediction-markets/orders/active`, then falls back to `/orders/history`. Balance uses the generic `POST /v1/balances` and reads the USD entry's `available`. Passing `clientOrderId` in the order body is also unconfirmed.
- Orders on mock markets (or in simulated mode) are simulated. A buy fills at the ask if `limitPrice >= ask`, and otherwise stays `open`. A sandbox order is reported as filled only if the exchange returns `filled` or a nonzero `filledQuantity`.
- Note: the sandbox right now mostly lists short-dated crypto and commodity contracts.

## Research: Context.dev (`src/lib/research.ts`)
- Env: `CONTEXT_DEV_API_KEY`, `CONTEXT_DEV_BASE_URL` (default `https://api.context.dev/v1`).
- Endpoint, taken from context.dev's `openapi.json`: `POST /web/search` with `Authorization: Bearer <key>` and body `{query, numResults}` (numResults minimum is 10). The response is `{results:[{url,title,description,...}]}`, sliced to `limit`.
- **Unverified:** no live call was made because we had no key. If the key is missing or the call errors, the function returns mock citations: titles start with `[mock] `, URLs are `https://example.com/mock/...`, and `source` is `"mock"`.

## Group chats (`src/lib/agent/group.ts`)
- Add Mayflower's iMessage account to a group. BlueBubbles group messages (chat guid contains `;+;`) are routed to `handleGroupMessage`; replies go back to the group via `sendToChat`.
- **Contest:** "Mayflower start a contest, $10 each, 1 week, loser buys dinner" → members pitch ("my pick: …") → each gets a fixed-stake trade and a *private* approval link → "Mayflower leaderboard" ranks by % return at mid price → scored at `endsAt` by the cron, or "Mayflower end contest". Positions stay open after scoring. Mayflower never holds the pot; the reward is a free-text IOU.
- **Group pick:** "Mayflower what should we bet on?" reads the last ~50 group messages, maps them to one live market, and members reply "in" to get their own trade.
- **Always listening:** every message is stored; after 12+ messages and 30+ min since the last suggestion, Claude checks whether the chat contains a strong tradeable opinion and only then posts. Without an LLM key it never interrupts.
- Approval links are only ever sent by DM — anyone holding a link can approve that order.

## Personal context connectors (`src/lib/connectors/*`)
Optional, opt-in, and revocable. Whatever Mayflower learns is **context for ideas, never permission to trade**. Raw text goes only to the Claude extraction call. We store short excerpts (200 chars max) plus the derived theses (`source` = provider, `sourceId` = the ConnectedSource), and the user can see all of it in the "Connected context" card. Disconnecting deletes the token, marks the source `revoked`, removes every thesis and excerpt derived from it, and makes a best-effort revoke call to Google or Slack.

- **Tokens:** encrypted at rest with AES-256-GCM (`src/lib/crypto.ts`). Set `MAYFLOWER_ENCRYPTION_KEY` to 32 random bytes encoded as base64 or hex: `openssl rand -base64 32`. In dev, if it's unset, the key is derived from `SESSION_SECRET` and a warning is logged. In production it is required. Rotating the key makes existing tokens unreadable, so users have to reconnect.
- **Redirect URI** for every provider: `${APP_URL}/api/connect/<provider>/callback`. For local dev that's `http://localhost:3000/api/connect/notion/callback`, and the same pattern for `slack` and `gmail`. It must match the registered value exactly.
- **OAuth state:** `${userId}.${provider}.${timestamp}` is HMAC-signed with `SESSION_SECRET` and expires after 15 minutes. The callback also requires the signed-in user to match.
- **Routes:** `GET /api/connect/<provider>/start`, `GET /api/connect/<provider>/callback`, `POST /api/connect/<provider>/sync`, `DELETE /api/connect/source/<id>`, and `GET /api/connect`, which lists sources with what was learned and never returns tokens.
- **Sync:** fetches up to 20 recent items of about 2k chars each. Claude extracts durable interests and opinions about real-world outcomes and ignores personal or private matters; content is treated as untrusted data. Without an LLM key, sync falls back to counting `KNOWN_TOPICS` keywords. Inferred confidence is capped at 0.8. A thesis the user stated directly (chat, iMessage, manual) is never overwritten. `syncAll()` is the cron entry point.

### Notion
Two modes are supported:
1. **Internal integration (simplest, single workspace):** go to https://www.notion.so/profile/integrations, choose New integration, pick type *Internal*, and grant the *Read content* capability only. Copy the secret into `NOTION_TOKEN`. In Notion, share the pages you want Mayflower to see with the integration (page menu, then Connections, then add it). "Connect" then stores this token for the current user and skips OAuth. Use this mode only for personal or demo deployments, because every user would share the same token.
2. **Public integration (OAuth):** on the same page, create an integration of type *Public*. Set the Redirect URI to `${APP_URL}/api/connect/notion/callback`, grant *Read content* only, and fill in the required company, website, and privacy policy fields. Put the OAuth client ID and secret in `NOTION_CLIENT_ID` and `NOTION_CLIENT_SECRET`. During authorization the user picks which pages to share. If both modes are configured, OAuth wins.
- API: `POST /v1/search` returns the pages edited most recently, and `GET /v1/blocks/{id}/children` returns their top-level text. Both use `Notion-Version: 2022-06-28`. Notion has no revoke call here, so users can also remove access under Settings, then Connections.

### Slack
1. Go to https://api.slack.com/apps and choose Create New App, then From scratch.
2. Under OAuth & Permissions, add the Redirect URL `${APP_URL}/api/connect/slack/callback`. Slack requires HTTPS for redirect URLs, so use a tunnel such as ngrok for local dev and set `APP_URL` to it.
3. Under **User Token Scopes** (not Bot), add `channels:history`, `groups:history`, `channels:read`, `groups:read`, `search:read`, and `users:read`.
4. Copy the Client ID and Client Secret from Basic Information into `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET`.
- API: `search.messages` with `query=from:me` fetches only the user's own messages. If that fails, it falls back to `users.conversations` plus `conversations.history` for up to 5 channels, filtered to the user. Disconnecting calls `auth.revoke`.
- **Distribution:** an unlisted app can be installed by your own workspace right away. To let other workspaces install it, turn on *Manage Distribution*. Listing it in the Slack Marketplace requires Slack's review, and `search:read` gets extra scrutiny.

### Gmail
1. In Google Cloud Console (https://console.cloud.google.com), create a project or pick an existing one, then enable the **Gmail API** under APIs & Services, then Library.
2. Configure the OAuth consent screen (Google Auth Platform): user type *External*, then add the scopes `.../auth/gmail.readonly`, `openid`, and `email`.
3. Under Credentials, choose Create OAuth client ID, type *Web application*. Add the Authorized redirect URI `${APP_URL}/api/connect/gmail/callback`, then copy the values into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
- `gmail.readonly` is a **restricted scope**. While the app's publishing status is *Testing*, only listed test users can connect, with a limit of 100, and their refresh tokens expire after 7 days. Production use requires Google's verification plus an annual third-party security assessment (CASA), so plan on Testing mode for the MVP.
- The auth request uses `access_type=offline&prompt=consent`, so it returns a refresh token. Access tokens are refreshed automatically when they expire, and the refreshed token is re-encrypted.
- API: `users.messages.list?q=newer_than:14d -category:social&maxResults=20`, then `messages.get?format=metadata` (Subject and From headers). Only the **subject and snippet** are used; full message bodies are never fetched. Disconnecting calls Google's token revoke endpoint.

## YZi receipts (`src/lib/receipts.ts`)
- Env: `BNB_TESTNET_PRIVATE_KEY` (a throwaway testnet key funded from the BSC testnet faucet) and `BNB_TESTNET_RPC` (default `https://data-seed-prebsc-1-s1.bnbchain.org:8545`). The chain is BSC testnet, chainId 97, accessed via `viem`.
- `commitReceipt({userId, kind, ref?, record})` builds canonical JSON (keys sorted recursively), takes its sha256, and stores an `AuditReceipt` (pending). With a key set, it sends a 0-value tx to self with `data = 0x + hex("mayflower:") + hash`, then marks the receipt `committed` (with `txHash`) or `failed`. Without a key, the status is `disabled`.
- **Only the hash goes onchain.** The canonical record is kept offchain in the audit log (`receipt.record`), so `verifyReceipt(id)` can recompute the hash and, when a tx exists, compare it with the tx calldata.
- Approval record: `{proposalId, version, userIdHash (HMAC), marketId, side, quantity, limitPrice, approvedAt}`. Policy record: the user's risk limits plus `"trade-only, no withdrawals"`.
- `onApproved(proposalId)` is called after a proposal is approved. It's fire-and-forget safe and idempotent.
- API: `GET /api/receipts` lists the user's receipts, `GET /api/receipts?verify=<id>` verifies one, and `POST /api/receipts {kind:"policy"}` commits the current policy. The UI is `src/components/Receipts.tsx`, which links each receipt to `https://testnet.bscscan.com/tx/<hash>`.
- Verified: the RPC is reachable and an unfunded key returns `failed` ("exceeds the balance"). A funded commit hasn't been exercised.

## Sentry
- Env: `SENTRY_DSN` (server/edge), `NEXT_PUBLIC_SENTRY_DSN` (browser), plus `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` and `SENTRY_PROJECT`, which are needed only for source-map upload.
- Files: `sentry.server.config.ts`, `sentry.edge.config.ts`, `src/instrumentation.ts` (`register()` and `onRequestError`), and `src/instrumentation-client.ts`. Every `init` is skipped when no DSN is set.
- `next.config.ts` is wrapped with `withSentryConfig` only when a DSN is set. Source maps upload only when `SENTRY_AUTH_TOKEN` is set.
- Privacy: `dataCollection` turns off user info, cookies, headers, bodies, query params (approval tokens live there) and gen-AI inputs/outputs.

## Trigger.dev
- Env: `TRIGGER_SECRET_KEY` and `TRIGGER_PROJECT_REF` (used by `trigger.config.ts`). In the Trigger.dev dashboard env, also set `APP_URL` and `CRON_SECRET`.
- `src/trigger/monitor.ts`: the scheduled task `mayflower-monitor` runs every 10 minutes and sends `POST ${APP_URL}/api/cron/monitor` with `Authorization: Bearer ${CRON_SECRET}`. The job logic stays in the app.
- Dev: `npm run trigger:dev`. Deploy: `npx trigger.dev@latest deploy`. Untested against a real Trigger.dev project.
