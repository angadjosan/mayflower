# BlueBubbles Integration Reference (researched 2026-10-11)

Source key: [DOC]=docs.bluebubbles.app, [SRC]=github.com/BlueBubblesApp/bluebubbles-server (master, `packages/server/src/server/`), [PM]=Postman collection (https://documenter.getpostman.com/view/765844/UV5RnfwM, JS-rendered; NOT readable by our fetcher, so endpoints were verified from [SRC] route files instead).
The official REST docs page is thin; request/response shapes below come mostly from server source. Paths are verified, not guessed.

## 1. Auth, base URL, versions
- Query param `guid` (aliases `password`, `token`) = the server password. Header auth is NOT supported. [DOC https://docs.bluebubbles.app/server/developer-guides/rest-api-and-webhooks.md] [SRC api/http/api/v1/middleware/authMiddleware.ts reads only `ctx.request.query`]
- Base: `https://<your-tunnel-host>/api/v1/...` e.g. `/api/v1/ping?guid=PASSWORD` [DOC same page]; routes registered under `/api/v1/<group>/<path>` [SRC api/http/api/v1/httpRoutes.ts]
- Success: `{status, message, data}`; error: `{status, message, error:{type,error}, data?}` [DOC same page]
- REST needs server >= 0.2.0, webhooks >= 1.0.0; use latest. Browser use requires HTTPS; non-browser (our Next.js backend) is fine over plain HTTP/LAN. [DOC same page]
- Since the password rides in the URL: keep it out of logs, use HTTPS.

## 2. Sending
`POST /api/v1/message/text?guid=PW` [SRC httpRoutes.ts group "message", path "text"]
```json
{ "chatGuid": "iMessage;-;+15555550123", "tempGuid": "mf-<uuid>", "message": "hi", "method": "private-api" }
```
- Validation rules [SRC validators/messageValidator.ts]: `chatGuid` required; `message` required-present string; `method` in `apple-script|private-api` (default `apple-script`); `tempGuid` REQUIRED when method is apple-script; optional `effectId`, `subject`, `selectedMessageGuid` (reply), `partIndex`, `ddScan`, `attributedBody`. Any of effectId/subject/selectedMessageGuid/ddScan/attributedBody silently forces `private-api`. Duplicate in-flight `tempGuid` is rejected 400.
- GOTCHA: the official Python example posts `text` instead of `message` [DOC https://docs.bluebubbles.app/server/developer-guides/simple-web-server-for-webhooks/python-web-server.md]; source validator says `message`. Use `message`.
- chatGuid format: `<service>;-;<address>` for 1:1 (`iMessage;-;+15555550123`, `iMessage;-;a@b.com`; `SMS;-;...`); group chats use `;+;`. The `;-;` form is built in source `ChatInterface.createWithAppleScript`. The `;+;` group form is **UNVERIFIED** from official docs (known from the Apple side, not stated in what I read).
- Response: serialized Message with `tempGuid` echoed back; a send-time failure returns an error whose `data` is the message with `error != 0`. [SRC routers/messageRouter.ts sendText]
- Look up chats: `POST /api/v1/chat/query` (body `with`, `sort`, `offset`, `limit<=1000`), `GET /api/v1/chat/count`. [SRC chatValidator/httpRoutes]
- Check if a number has iMessage: `GET /api/v1/handle/availability/imessage?address=...` (Private API required; returns `data.available`). [SRC handleRouter.ts, httpRoutes.ts]

### New chat (no existing chat)
`POST /api/v1/chat/new?guid=PW` [SRC httpRoutes.ts]
```json
{ "addresses": ["+15555550123"], "message": "hello", "method": "private-api", "service": "iMessage", "tempGuid": "mf-<uuid>" }
```
- `addresses` required array; `message` REQUIRED for both methods on modern macOS; `service` iMessage|SMS. Response `data` = chat incl. `guid`, participants, messages. [SRC chatValidator.createRules, ChatInterface.create]
- `private-api` path: needs Private API connected; server waits up to 30s for the chat to appear. [SRC ChatInterface.createWithPrivateApi]
- `apple-script` path (default) on macOS Big Sur+: ONE address only, message required; implementation just sends to inferred guid `iMessage;-;<address>` (so plain `POST /message/text` to that guid is the AppleScript equivalent). Group creation on Big Sur+ via AppleScript throws. [SRC ChatInterface.create/createWithAppleScript]
- Addresses are normalized; non-US numbers need `+<country code>` or server falls back to macOS region, then `+1`. [DOC https://docs.bluebubbles.app/server/troubleshooting-guides/unable-to-send-messages-to-international-contacts.md] Always send E.164.

## 3. Webhooks
Register (UI): Server app > API/Webhooks settings, add URL + pick events (UI path **UNVERIFIED** in docs I read; [DOC rest-api page] only says "provide a URL").
Register (API) [SRC httpRoutes.ts group "webhook", webhookValidator.ts, routers/webhookRouter.ts]:
```
POST   /api/v1/webhook?guid=PW   {"url":"https://app.example.com/api/bb","events":["new-message","updated-message"]}
GET    /api/v1/webhook?guid=PW   (optional ?url= / ?id=)
DELETE /api/v1/webhook/:id?guid=PW
```
- `url` must start with `http`; `events` is an array of strings from the list below; re-adding the same URL returns the existing row (does not update events, so DELETE then POST to change). [SRC databases/server/index.ts addWebhook]
- Event values [SRC api/http/constants.ts webhookEventOptions]: `*` (all), `new-message`, `updated-message`, `message-send-error`, `group-name-change`, `group-icon-changed`, `group-icon-removed`, `participant-removed`, `participant-added`, `participant-left`, `chat-read-status-changed`, `typing-indicator`, `scheduled-message-error`, `server-update`, `new-server`, `hello-world`, `incoming-facetime`, `ft-call-status-changed`, `imessage-alias-removed`, plus backup/findmy events.
- Delivery: plain `axios.post(url, {type, data}, {Content-Type: application/json})`, fire-and-forget; failures are only debug-logged, NO retry. [SRC services/webhookService/index.ts] => our receiver must return 200 fast and be idempotent; downtime = lost messages (backfill via `POST /message/query` is **UNVERIFIED** as a recipe, endpoint exists in httpRoutes).

### Inbound payload (`new-message`)
Envelope `{ "type": "new-message", "data": <Message> }` [SRC webhookService; official Python example reads `data.get('type')`, `data['data']['isFromMe']`, `data['data']['chats'][0]['guid']`]. Message fields from [SRC serializers/MessageSerializer.ts]; example values are illustrative:
```json
{ "type": "new-message",
  "data": {
    "guid": "p:0/ABCD-...", "text": "hello", "isFromMe": false,
    "handle": { "address": "+15555550123", "service": "iMessage" },
    "handleId": 12, "dateCreated": 1760000000000, "dateRead": null,
    "isDelivered": false, "error": 0, "itemType": 0,
    "associatedMessageGuid": null, "associatedMessageType": null,
    "attachments": [ { "guid": "...", "mimeType": "image/jpeg", "transferName": "IMG_1.jpeg" } ],
    "chats": [ { "guid": "iMessage;-;+15555550123", "style": 45 } ],
    "tempGuid": "mf-<uuid>   (only present on echoes of messages WE sent)"
  } }
```
Exact `handle` / `chats` / attachment sub-field names are **UNVERIFIED** (serializers for Handle/Chat/Attachment not read; confirm with a live `hello-world`/real event capture or [PM]). Sender = `data.handle.address` (assumed); reply target = `data.chats[0].guid`.

### Echo loops
- Outbound messages DO come back as `new-message` with `isFromMe: true` (server emits every chat.db row; our own sends are re-emitted with `tempGuid` set). [SRC index.ts emitMessageMatch, handleNewMessage]
- Rule: drop `data.isFromMe === true` first (official example does this). Secondary: dedupe on `data.guid`, and ignore events whose `tempGuid` we minted (store prefix `mf-`). Also ignore `itemType != 0`/tapbacks (`associatedMessageType` set) unless wanted.
- `updated-message` fires for delivered/read changes on both directions; subscribe only if needed.

## 4. Webhook security
- NOT signed, no HMAC, no auth header, no secret field: payload is bare JSON. [SRC webhookService sendPost; [DOC rest-api page] describes no verification]
- Therefore (our design, not official): put a long random token in the registered URL path or query (`https://app/api/bb/<TOKEN>`), compare constant-time, reject others with 404; never log the URL; optionally also restrict by source IP (Mac's egress IP / tunnel) and re-validate by fetching the message via `GET /api/v1/message/:guid?guid=PW` before acting on it. HTTPS only.

## 5. Private API
- Needs: SIP disabled via Recovery `csrutil disable`, Library Validation disabled (`sudo defaults write /Library/Preferences/com.apple.security.libraryvalidation.plist DisableLibraryValidation -bool true`), toggle Private API in server settings, check status. Helper supports macOS 10.13+, Intel + Apple Silicon. [DOC https://docs.bluebubbles.app/private-api/installation]
- Tested range stated as macOS 10.13 to 13 (Ventura); higher "could work" but unconfirmed. [DOC https://docs.bluebubbles.app/private-api/] So macOS 14/15/26 is a **risk**; third-party notes (not official) say edit broke on Tahoe.
- Routes gated by `PrivateApiMiddleware` in [SRC httpRoutes.ts]: `POST /message/react`, `POST /chat/:guid/typing` + `DELETE` (typing), `POST /chat/:guid/read|unread`, participants add/remove, group icon, `GET /handle/availability/imessage`, message edit/unsend/notify. `POST /message/text` and `/chat/new` themselves are NOT gated unless `method=private-api` (or effect/subject/reply forces it).
- Without it: AppleScript sending works (less reliable, slower); no typing, reactions, read receipts, edits, reply threading, effects. [DOC https://docs.bluebubbles.app/server/troubleshooting-guides/cant-send-messages-from-bluebubbles.md says AppleScript is "much less reliable" and recommends Private API]
- Hackathon verdict: ship with `apple-script` first; add Private API only if SIP can be disabled on that Mac.

## 6. Exposing the server
- Built-in proxy options in the server repo: ngrok, Cloudflare (`cloudflared` quick tunnel), zrok [SRC services/proxyServices/{ngrokService,cloudflareService,zrokService}]; docs also cover Dynamic DNS + port-forward, Caddy/DuckDNS, Nginx, Tailscale, Cloudflare custom domain. [DOC sitemap https://docs.bluebubbles.app/server/sitemap.md]
- Two directions: (a) Mac -> our backend (webhook): our API must be reachable from the Mac; if our API is on localhost/Vercel it's fine (Mac makes outbound calls). (b) our backend -> Mac (REST): needs the tunnel URL; server pushes its current URL via `new-server` webhook event, and free ngrok/cf-quick URLs CHANGE on restart. Tailscale or a named Cloudflare tunnel avoids that.
- Keep Mac awake: [DOC https://docs.bluebubbles.app/server/basic-guides/preventing-macos-from-sleeping.md]; auto-restart: [DOC .../autostart-server-after-crash.md].

## 7. Clients
- No official Node/TS SDK. [DOC rest-api page lists only a Java wrapper "blueify"]
- Community: `@anmho/bluebubbles-sdk` (npm 0.1.3, MIT, github.com/anmho/bluebubbles-sdk) exists; maturity UNVERIFIED. Others seen in third-party docs (OpenClaw channel) are bespoke.
- Recommendation: plain `fetch` with a ~40-line wrapper (`send`, `newChat`, `registerWebhook`); surface is tiny and the SDK's field accuracy is unverified.

## 8. Gotchas
- Rate limits: none documented. **UNVERIFIED**. Apple-side spam flagging is the real limit: flagged iMessage account/Mac serial stops sends. [DOC cant-send-messages page] Throttle outbound.
- `tempGuid` mandatory for AppleScript sends; duplicate in-flight tempGuid = 400. Generate a fresh UUID per send.
- First run: macOS pops an "automation / System Events" permission prompt; sends fail until allowed. [DOC cant-send-messages page] Also Full Disk Access needed to read chat.db (standard setup; not re-verified here).
- Test that the Mac can send from the native Messages app; green-bubble SMS fallback or account flags break everything. [DOC same]
- Send responses can be slow (AppleScript path); treat `POST` as async and rely on `new-message` echo with `tempGuid` / `message-send-error` for outcome.
- Messages to a number without iMessage go SMS only if `service:"SMS"` and SMS forwarding is set up (**UNVERIFIED**); use the availability endpoint (Private API) to pre-check.
- Docs/Postman drift from source: confirm every body field with a live curl on the Mac before demo time.
- macOS: server runs on Sierra+ with iMessage signed in; docs recommend Catalina/Big Sur for stability. [DOC https://docs.bluebubbles.app/server/readme.md] Behavior on newest macOS: **UNVERIFIED**.
