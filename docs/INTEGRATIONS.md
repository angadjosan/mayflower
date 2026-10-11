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
