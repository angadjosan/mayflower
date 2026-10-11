# Gemini Exchange Prediction Markets: integration reference (researched 2026-10-11)

Doc root: https://developer.gemini.com (docs.gemini.com 301-redirects there). Every page has a `.md` twin
(e.g. https://developer.gemini.com/authentication/api-key.md). Index: https://developer.gemini.com/llms.txt
Specs (primary source for paths/schemas):
- REST OpenAPI: https://developer.gemini.com/specs/openapi/prediction-markets.yaml
- WS AsyncAPI:  https://developer.gemini.com/specs/asyncapi/websocket.yaml
- Catalog: https://developer.gemini.com/specs/index.json

## TOP-LINE (read first)
- The product EXISTS and is live. Everything below is from official docs/specs unless marked UNVERIFIED.
- An official TS SDK EXISTS: `@gemini-markets/sdk` (see section 4). It is 0.1.1, young; hand-rolled signer is a fine fallback.
- The sandbox HAS prediction markets. Verified by live call today: `GET https://api.sandbox.gemini.com/v1/prediction-markets/events?status=active&limit=1` returned HTTP 200 with live-looking BTC hourly markets (ticker `BTC2610112000`, instrumentSymbol `GEMI-BTC2610112000-HI83400`). Public reads need no key.
- BIGGEST GOTCHA: private POSTs do NOT use a JSON HTTP body. Body is empty (`Content-Length: 0`); the JSON is base64'd into the `X-GEMINI-PAYLOAD` header, HMAC-SHA384 signed. The payload must carry `request` (the path) + `nonce` + the order fields. Source: https://developer.gemini.com/authentication/api-key.md
- Second gotcha: terms acceptance gate. Orders fail with `TERMS_NOT_ACCEPTED` until `POST /v1/prediction-markets/terms/accept` is called once per account group. https://developer.gemini.com/rest-api/prediction-markets/order-management/place-order.md
- Third: there is NO "get order by id" and NO REST order book / quote endpoint in the PM spec. Order status = `orders/active` + `orders/history` (REST) or `orders@account` stream (WS). Books/prices = WebSocket depth streams, or the `prices` object embedded in the events list.
- NOT FOUND: any B@BHacks / Gemini-track sponsor material (searches hit only the Luma page https://luma.com/ng6r9j5s, which lists no Gemini track). All track-specific rules (judging, required endpoints, provided keys) are UNVERIFIED. Check babhacks.com / Devpost / the hackathon Discord.

## 1. Base URLs, sandbox account, keys, funds
| | Production | Sandbox |
|---|---|---|
| REST | `https://api.gemini.com` | `https://api.sandbox.gemini.com` |
| WebSocket | `wss://ws.gemini.com` | `wss://ws.sandbox.gemini.com` |
| Website/keys page | https://exchange.gemini.com/settings/api | https://exchange.sandbox.gemini.com/settings/api |
Sources: https://developer.gemini.com/get-started/sandbox.md ; OpenAPI `servers`; AsyncAPI `servers`.
- Account: register at https://exchange.sandbox.gemini.com . New accounts auto-credited $100,000 USD (+ BTC/ETH/etc). Only BTC testnet deposit/withdraw. No email notifications (email trading@gemini.com for balance top-ups).
- 2FA is on by default. Bypass for automation: set cookie/header `GEMINI-SANDBOX-2FA=true`, enter code `9999999`. (same sandbox.md)
- API keys: Settings/API on the sandbox site. Key prefix `account-...` or `master-...`; choose nonce mode at creation (see 2). Default role is Trader (https://developer.gemini.com/roles.md). Sandbox keys are separate from prod keys.
- Sandbox has bot-simulated order book activity (sandbox.md). Observed live: sandbox spreads can be wide (bid 0.03 / ask 0.07 on one contract).
- UNVERIFIED: whether sandbox PM funding needs anything beyond the auto USD credit. Sandbox PM terms text is placeholder ("testing 123", version 2, from `GET /v1/prediction-markets/terms` on sandbox).

## 2. Auth (API key, HMAC-SHA384)
Source: https://developer.gemini.com/authentication/api-key.md
Headers on every private request: `Content-Type: text/plain`, `Content-Length: 0`, `X-GEMINI-APIKEY`, `X-GEMINI-PAYLOAD`, `X-GEMINI-SIGNATURE`, `Cache-Control: no-cache`.
- payload = JSON object `{ "request": "<path>", "nonce": <n>, ...endpoint params }`
- `X-GEMINI-PAYLOAD = base64(JSON.stringify(payload))`
- `X-GEMINI-SIGNATURE = hex(HMAC_SHA384(key=apiSecret, msg=<the base64 string>))`  (sign the base64 text, not raw JSON)
- Nonce modes (chosen per key at creation): time-based = Unix SECONDS, must be within +/-30 s of server; incremental = strictly increasing per key (ms timestamp OK). Errors: `InvalidNonce`, `InvalidSignature`, `MissingApikeyHeader` etc (400); `InvalidApiKey` (403).
- Do not send OAuth and API-key headers together: `AmbiguousAuthentication`.
- Optional "Requires Heartbeat" key setting: no authed request for 30 s cancels all session orders.
- Master keys (`master-`) need `"account": "<name>"` in payload. WS auth rejects master/group keys (account-scoped only).
- SDK docs say monotonic ms nonce is default but "use time-based if the sandbox returns InvalidNonce" (https://developer.gemini.com/tools/typescript-sdk/authentication.md). Simplest: create key as time-based, nonce = `Math.floor(Date.now()/1000)`. NOTE seconds nonce means two requests in the same second are fine only in time-based mode.
- INFERENCE (not stated verbatim for PM, but consistent with the SDK deep dive https://developer.gemini.com/tools/typescript-sdk/deep-dives/transport-and-signing.md and the OpenAPI order example): for PM POSTs the payload is `{request:"/v1/prediction-markets/order", nonce, symbol, orderType, side, quantity, price, outcome, timeInForce}`. Verify with one sandbox order before building around it.
Public GET endpoints: no headers, query-string params.

```ts
import { createHmac } from "node:crypto";
export async function gemPost(base: string, key: string, secret: string, path: string, body: Record<string, unknown> = {}) {
  const payload = { request: path, nonce: Math.floor(Date.now() / 1000), ...body };
  const b64 = Buffer.from(JSON.stringify(payload)).toString("base64");
  const sig = createHmac("sha384", secret).update(b64).digest("hex");
  const r = await fetch(base + path, { method: "POST", headers: {
    "Content-Type": "text/plain", "Content-Length": "0", "Cache-Control": "no-cache",
    "X-GEMINI-APIKEY": key, "X-GEMINI-PAYLOAD": b64, "X-GEMINI-SIGNATURE": sig } });
  return { status: r.status, json: await r.json() };
}
```
(Node fetch may refuse a manual Content-Length header; if so omit it or use undici/axios.)

## 3. Endpoints (all from the OpenAPI spec; base = REST host above)
Roles/scopes in 5. Pagination: `limit`/`offset`. Prices/quantities are DECIMAL STRINGS.

### Discovery (public GET, no auth)
- `GET /v1/prediction-markets/events` query: `status[]` (approved|active|closed|under_review|settled|invalid), `category[]`, `search`, `limit`, `offset`, plus sports filters (`sport`, marketType etc). Returns `{data:[Event], pagination:{limit,offset,total}}`.
- `GET /v1/prediction-markets/events/{eventTicker}`; also `/events/newly-listed`, `/events/recently-settled`, `/events/upcoming`, `/events/{eventTicker}/strike`, `GET /v1/prediction-markets/categories`.
- Event fields: `id,title,slug,description,type(binary|categorical),category,ticker,status,effectiveDate,expiryDate,resolvedAt,liquidity,volume,tags,source,sourceDetails{agency,index},settlement{value},contracts[],contractOrderbooks{}`.
- Contract fields: `id,label,abbreviatedName,description` (RICH-TEXT document tree; resolution rules prose lives in `description.content[].value`), `termsAndConditionsUrl` (full-rules PDF), `ticker`, **`instrumentSymbol`** (e.g. `GEMI-BTC2610112000-HI83400`; used for orders and WS), `status`, `marketState` (open|closed), `expiryDate`, `effectiveDate`, `resolutionSide` (yes|no|null), `resolvedAt`, `settlementValue`, `strike{type,value}`, `prices{buy{yes,no}, sell{yes,no}, bestBid, bestAsk, lastTradePrice}`, and grid metadata `quantityIncrement, quantityMinimum, priceIncrement, priceMinimum, quoteAssetPrecision`.
- Live sandbox example values: `priceIncrement:"0.01"`, `quantityMinimum:"0.01"`, `quantityIncrement:"0.01"`, `priceMinimum:"0.01"`. Do NOT hardcode; spec says grid is per instrument.
- Source: https://developer.gemini.com/specs/openapi/prediction-markets.yaml ; live call verified.

### Terms (required once before first order)
- `GET /v1/prediction-markets/terms` public -> `{termsType,version,content,updatedAt}`
- `GET /v1/prediction-markets/terms/status` auth -> `{hasAcceptedLatest,acceptedVersion,latestVersion}`
- `POST /v1/prediction-markets/terms/accept` auth -> `{success:true}`

### Place order: `POST /v1/prediction-markets/order` (auth, 201)
Fields: `symbol` (instrumentSymbol), `orderType` ("limit"|"stop-limit"), `side` ("buy"|"sell"), `quantity` (str), `price` (str, 0-1), `outcome` ("yes"|"no"), optional `timeInForce` ("good-til-cancel" default | "immediate-or-cancel" | "fill-or-kill"), `makerOrCancel` (bool, post-only), `stopPrice` (stop-limit only).
```json
{"symbol":"GEMI-BTC2610112000-HI83400","orderType":"limit","side":"buy","quantity":"10","price":"0.05","outcome":"yes","timeInForce":"good-til-cancel"}
```
Response: `{orderId(int64), hashOrderId, clientOrderId|null, globalOrderId, status(open|filled|cancelled), symbol, side, outcome, orderType, quantity, filledQuantity, remainingQuantity, price, stopPrice, avgExecutionPrice, createdAt, updatedAt, cancelledAt, contractMetadata{contractId,eventTicker,eventName,category,contractStatus,expiryDate,...}}`.
- Idempotency / client order id: the REST `OrderRequest` schema has NO `clientOrderId` field (response has one, null). WS `order.place` DOES accept `clientOrderId`, and rejects reuse as `DuplicateOrder`. For REST, idempotency is UNVERIFIED; dedupe yourself and reconcile via `orders/active`.
- Errors: 400, 401, 403 (e.g. `ACCOUNT_GROUP_BLOCKED`), 409, 422 (rejected e.g. insufficient funds), `TERMS_NOT_ACCEPTED`, `ACCOUNT_RESTRICTED_SELL_ONLY`. Source: place-order page + spec.
- Batch: `POST /v1/prediction-markets/order/batch` body `{orders:[<1-20 OrderRequest>]}`; sync, non-atomic; per-entry result `{order}` or `{error,message}`.
- YES/NO semantic: a contract is one YES-space proposition; `outcome:"no"` is the other side at price 1-p. Public depth is normalized to YES space (streams doc).

### Cancel / list orders
- `POST /v1/prediction-markets/order/cancel` body `{orderId}` -> `{result:"ok", message}` (per SDK doc). Batch: `POST /v1/prediction-markets/order/batch/cancel`.
- `POST /v1/prediction-markets/orders/active` body `{symbol?, limit<=100, offset}` -> open orders (same shape as OrderResponse).
- `POST /v1/prediction-markets/orders/history` body `{status: filled|cancelled, symbol?, limit<=1000, offset, from?, to?}`; `[from,to)`; with from/to offset is ignored. This is the FILLS source on REST (filledQuantity + avgExecutionPrice per order; no per-trade fills endpoint in PM spec). Per-fill detail (price `L`, qty, fee `n`, maker flag `m`) comes from the `orders@account` WS stream.

### Positions
- `POST /v1/prediction-markets/positions` query/body: `eventTicker, limit(1-1000), offset, sort (positionValue|unrealizedPnl|expiryDate...)` -> positions: `symbol, outcome, totalQuantity, quantityOnHold, avgPrice, realizedPl, marketValue (ABSENT if no live sell quote), prices{buy,sell,bestBid,bestAsk,lastTradePrice}, resolutionSide, contractMetadata`.
- `POST /v1/prediction-markets/positions/settled` -> settled history. `POST /v1/prediction-markets/metrics/volume` -> volume metrics.

### Balances (general exchange endpoint, not PM-specific)
- `POST /v1/balances` payload `{request:"/v1/balances", nonce, account:"primary"}` -> array of `{currency, amount, available, availableForWithdrawal, type}`. Source: https://developer.gemini.com/trading/rest-api/fund-management/get-available-balances.md . PM positions/orders are funded from USD. WS: `balances@account` stream.
- Also public: volume `GET /v1/prediction-markets/volume/{date}` (+`/hourly`), combos `/v1/prediction-markets/combos`, rewards endpoints (out of MVP scope).

## 4. Official TypeScript SDK
EXISTS. npm `@gemini-markets/sdk` latest `0.1.1` (published 2026-09-25, Apache-2.0, Node >=22.4). Repo: https://github.com/gemini/developer-platform (dir `packages/sdk-typescript`). Source: npm registry JSON + https://developer.gemini.com/tools/typescript-sdk/quickstart.md
- No bare import; use `@gemini-markets/sdk/server` (HMAC, confidential OAuth, WS via optional `ws` peer dep) or `/browser` (public data + OAuth PKCE only; REST only).
```ts
import { createClient, HmacAuth } from "@gemini-markets/sdk/server";
const client = await createClient({ env: "sandbox", skipWsInit: true,
  auth: new HmacAuth({ apiKey, apiSecret, nonceMode: "time-based" }) });
const ev = await client.predictions.listEvents({ status: ["active"] });
await client.predictions.getPredictionMarketsTermsStatus(); // then acceptTerms()
const o = await client.predictions.placeOrder({ symbol, orderType:"limit", side:"buy",
  quantity:"10", price:"0.05", outcome:"yes", makerOrCancel:false });
```
- SDK quirk: `makerOrCancel` is marked required in the SDK's local validator (order-management page) though optional in the OpenAPI. `orderId` is `bigint` in SDK. POSTs are never auto-retried. Throws `AcceptTermsRequired`, `ValidationError`.
- Reference: https://developer.gemini.com/tools/typescript-sdk/reference/predictions/order-management.md . Risk: v0.1.x, API churn likely; pin the version.

## 5. OAuth 2.0
Source: https://developer.gemini.com/authentication/oauth.md ; changelog https://developer.gemini.com/changelog/revision-history.md (2026-05-28 added PM endpoints to scopes table; 2026-07-22 "sandbox OAuth proof").
- EXISTS. Authorization-code grant with refresh tokens. Confidential client (client_id+secret) or public client (client_id only, PKCE S256 mandatory, `state` required).
- Authorize: `GET https://exchange.gemini.com/auth?client_id=&response_type=code&redirect_uri=&state=&scope=orders:read,orders:create[&code_challenge=&code_challenge_method=S256]`. Token: `POST https://exchange.gemini.com/auth/token` (`grant_type=authorization_code|refresh_token`). Revoke: `POST https://exchange.gemini.com/auth/token/revoke`. Access token lives 24 h; refresh tokens non-expiring but SINGLE-USE per SDK doc (serialize refreshes).
- Register app at Settings/API. Production apps need Gemini review (email trading@gemini.com); sandbox apps register immediately at https://exchange.sandbox.gemini.com/settings/api .
- Scopes for PM: `orders:create` = place order, batch, cancel, batch cancel, terms/accept; `orders:read` = terms/status, orders/active, orders/history, positions, positions/settled, volume metrics; `balances:read` = balances; WS positions stream needs `positions:read` or `predictions:positions:read`. Roles (not OAuth): API-key "Trader" role is required to place orders; "Fund Manager" is withdrawals/transfers/addresses, NOT trading (https://developer.gemini.com/roles.md). Auditor is read-only.
- Use: send `Authorization: Bearer <token>`; `X-GEMINI-PAYLOAD` is still sent but no signature/nonce (transport-and-signing deep dive). WS accepts bearer on upgrade (changelog 2026-05-28). Browser OAuth = REST only.
- UNVERIFIED: the exact sandbox OAuth authorize/token HOSTS. Docs only show `exchange.gemini.com`; by analogy sandbox is `exchange.sandbox.gemini.com/auth` and `.../auth/token`, but the SDK `env:"sandbox"` presumably handles it; read `BrowserOAuthAuth` source in the repo before relying on it. Also UNVERIFIED: that OAuth-created orders work end to end in sandbox PM (changelog claims a "sandbox OAuth proof" only).
- For a hackathon: API keys in sandbox are far faster than OAuth.

## 6. WebSocket (prediction markets)
Sources: https://developer.gemini.com/prediction-markets/websocket/introduction.md , .../websocket/streams.md , AsyncAPI spec.
- URL `wss://ws.gemini.com` / `wss://ws.sandbox.gemini.com`. Query params: `snapshot=-1` (full book on first depth frame) and `cancelOnDisconnect=true`.
- Subscribe: `{"id":"1","method":"SUBSCRIBE","params":["<stream>"]}` -> ack `{"id":"1","status":200}`.
- Public streams (symbol = instrumentSymbol): `{symbol}@bookTicker` (u,E,s,b,B,a,A, optional c/C last trade), `{symbol}@depth5|10|20[@100ms]` (`bids/asks [[price,qty]]`), `{symbol}@depth[@100ms]` (diff; qty "0" removes level), `{symbol}@trade` (p,q,m,t), `contractStatus`, `{agency}:{index}@indexPrice` (Lukka BTC/ETH/SOL etc).
- Depth is in YES space. YES notional = yesPrice*qty; NO side uses (1-price).
- Authed (handshake headers: HMAC key headers OR OAuth bearer; cannot auth after connect; browsers cannot, so proxy via server): `orders@account`, `orders@session`, `balances@account[@1s]`, `positions@account[@1s]`. Order events: `X` status NEW/OPEN/FILLED/PARTIALLY_FILLED/CANCELED/REJECTED, `i` orderId, `c` clientOrderId, `L` last px, `Z` executed qty, `n` fee, `m` maker flag, `r` reason.
- WS trading: methods `order.place`, `order.cancel`, `order.cancel_all`, `order.cancel_session`. Params differ from REST: `{symbol, side:"BUY", type:"LIMIT", timeInForce:"GTC|IOC|FOK|MOC", quantity, price, clientOrderId, eventOutcome:"YES"|"NO"}`. Docs call WS the PREFERRED trading path; REST placement is for "one-off server workflows" (fine for an MVP with user-approved single orders).
- Sandbox note: changelog 2026-07-22 says sandbox live books use the Prediction Markets WS host (i.e. `wss://ws.sandbox.gemini.com`).

## 7. Limits and gotchas
- Rate limits (https://developer.gemini.com/rate-limit.md): public 120 req/min (recommend <=1/s); private 600 req/min (recommend <=5/s); burst of 5 queued, then HTTP 429.
- Price units: contract prices are DOLLARS 0-1 as strings (e.g. "0.65"), payout $1 per winning contract. Rejection text says valid price range is $0.01-$0.99 (`InvalidPrice`). Do not send numbers; send strings (SDK rejects non-strings).
- Grid: use per-contract `priceIncrement`, `quantityMinimum`, `quantityIncrement` from the events response; violations give `LimitPriceOffTick` / `InvalidQuantity`. Observed 0.01 / 0.01 / 0.01 for BTC hourly in sandbox and prod.
- Hours/state: check `marketState` (open|closed) and `status`; `MarketNotOpen` rejection. Contracts have `effectiveDate` (trading start) before `expiryDate`; short-duration crypto markets (5m/15m/hourly) expire quickly, so filter by expiryDate for demos. Sandbox rolls these hourly (observed).
- Order semantics: IOC/FOK/MOC orders are accepted then cancelled, never REJECTED; a fully filled IOC still ends in a CANCELED event, so use executed qty `Z`.
- Insufficient funds comes back as 422 on REST. Self-trade prevention: `SelfCrossPrevented`.
- Stop-limit has strict inequality rules on REST (`stopPrice` vs `price`); skip stop-limit for MVP.
- Undocumented response fields "may change or be removed without notice"; only spec-listed fields are stable.
- Geo/eligibility: changelog 2026-03-31 "Removed the US-only trading callout"; https://developer.gemini.com/developers says access depends on product, account, jurisdiction, permissions. Exact restricted jurisdictions are UNVERIFIED. Sandbox-only use has no stated restriction; production account/KYC requirements UNVERIFIED.
- Fees: `n` field on fills; maker rebate/fee-free promos exist (changelog 2026-08-26). Fee schedule for takers UNVERIFIED (not needed for sandbox).
- MCP server + agent skills exist: https://developer.gemini.com/tools (referenced in llms.txt; not read). Possibly useful for the hackathon; UNVERIFIED contents.

## Open items to resolve with one sandbox smoke test
1. Place a 1-contract limit buy far from market; confirm payload shape (section 2 INFERENCE), 201 body, and `orders/active` visibility.
2. Confirm terms accept works in sandbox and whether it must precede the first order.
3. Check nonce mode on the freshly created sandbox key (time-based vs incremental).
4. Cancel it; confirm `orders/history` shows status cancelled.

## Market coverage probe (run 2026-10-11 12:18 PDT, public `GET /v1/prediction-markets/events?status=active&limit=500`, no key)

| Host | Active events | Categories |
|---|---|---|
| `api.sandbox.gemini.com` | 94 | Crypto 76, Commodities 18. **No Sports, Politics, Economics or Culture.** |
| `api.gemini.com` (production) | 500+ (page cap hit) | Sports 319, Politics 124, Crypto 48, Commodities 4, Culture 3, Economics 2 |

- **The spec's football demo cannot execute in sandbox.** Production lists Seahawks markets (`San Francisco vs Seattle`, plus spread / total points / player TD variants, `Seattle vs Denver`); sandbox has none. No AI-themed markets on either host.
- Public reads on **production** need no key, so real catalog + real prices are available for discovery and research. Orders can only go to sandbox.
- Framework consequence: tag every market with where it can trade. Sandbox-listed markets get real sandbox orders; production-only markets can only get a **paper order labeled "simulated"** (spec §MVP allows this if labeled honestly).
- Contract shape (sandbox): `prices: {buy:{yes,no}, sell:{yes,no}, bestBid, bestAsk}` as dollar strings, plus `priceIncrement`, `priceMinimum`, `quantityIncrement`, `quantityMinimum`, `instrumentSymbol`, `marketState`, `expiryDate`.
