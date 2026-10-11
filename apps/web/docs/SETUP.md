# Setup

## 1. Local, no keys
```bash
npm install && npm run dev
```
Open http://localhost:3000. A per-browser demo user is created on first message. The LLM is a
scripted mock, so conversational onboarding only works meaningfully once `GOOGLE_API_KEY` is set;
the dashboard buttons ("Find opportunities", "Check positions") exercise the full pipeline against
the simulated venue.

## 2. Google Gemini (LLM)
Create a key at https://aistudio.google.com → `GOOGLE_API_KEY`. Models default to
`gemini-3.8-flash` (routing, extraction, critic) and `gemini-3.1-pro-preview` (forecasting).
Structured output uses `responseMimeType: application/json` + `responseJsonSchema` generated from
the zod schemas in `packages/shared`.

## 3. Context.dev
Sign up at https://context.dev, create a key (`ctxt_secret_…`) → `CONTEXT_DEV_API_KEY`.
Free tier: 1,000 credits/month (search = 1 credit per 10 results, +1 with highlights).
The adapter uses `POST /v1/web/search` and `POST /v1/web/scrape`; monitors use `POST /v1/monitors`
with webhooks to `/api/webhooks/context` (set `CONTEXT_DEV_WEBHOOK_SECRET` to the monitor's secret).

## 4. Gemini prediction markets (sandbox)
1. Register at https://exchange.sandbox.gemini.com (2FA bypass code `9999999`). Sandbox accounts
   come pre-funded with test USD.
2. Create an **account-scoped** API key with the **Trader** role and **time-based nonce**.
3. Either set `GEMINI_SANDBOX_API_KEY/SECRET` (Plan B shared account; dashboard labels it
   "Sandbox – shared account") or paste a key per user under Settings → Gemini account (Plan A fallback).
4. `MAYFLOWER_EXCHANGE_MODE=sandbox`.
5. For OAuth (Plan A proper), register an app at exchange.sandbox.gemini.com/settings/api with redirect
   `<APP_URL>/api/exchange/oauth/callback`, then set `GEMINI_OAUTH_CLIENT_ID/SECRET`.

Verified endpoints: `GET /v1/prediction-markets/events`, `POST /v1/prediction-markets/order`,
`/orders/active`, `/orders/history`, `/positions`, `/terms/status|accept`, `POST /v1/balances`.
The adapter accepts the prediction-markets terms automatically the first time it trades.

## 5. Supabase
```bash
supabase link --project-ref <ref>
supabase db push            # applies supabase/migrations/0001_init.sql
```
Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
Generate `MAYFLOWER_ENCRYPTION_KEY` with `openssl rand -base64 32` (encrypts exchange credentials).
Supabase Auth sign-in UI is an opening: `src/lib/user.ts` already resolves a Supabase session when
present and falls back to the demo cookie otherwise.

## 6. iMessage via BlueBubbles
1. Dedicated always-on Mac signed into Mayflower's Apple ID; install BlueBubbles Server
   (https://bluebubbles.app). Enable the Private API for reliable sends.
2. Expose it with a Cloudflare **named** tunnel or Tailscale (the default quick tunnel URL rotates).
   Set `BLUEBUBBLES_URL` and `BLUEBUBBLES_PASSWORD`.
3. In BlueBubbles → API & Webhooks add
   `<NEXT_PUBLIC_APP_URL>/api/webhooks/bluebubbles/<BLUEBUBBLES_WEBHOOK_SECRET>` with event `new-message`.
   BlueBubbles does not sign webhooks, so the secret in the URL is the auth.
4. Text the Mac's number. First message creates a user keyed by the phone/Apple ID handle.

If the Mac is down, `/api/health` reports `imessage.reachable=false` and the dashboard chat is the
fallback (same agent, same history).

## 7. Trigger.dev
```bash
cd apps/web && npx trigger.dev@latest dev
```
Set `TRIGGER_SECRET_KEY` and `TRIGGER_PROJECT_REF`. Tasks: `mayflower-market-scan` (every 6h),
`mayflower-position-monitor` (every 30m, also reconciles open orders), `mayflower-scan-user`.

## 8. Deploy
Vercel for `apps/web` (root directory `apps/web`, install command `npm install` at repo root).
Set `maxDuration` is already declared on long routes. Add `SENTRY_DSN` and `@sentry/nextjs` when ready
(an opening; not wired yet).
