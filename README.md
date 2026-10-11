# Mayflower

An AI hedge fund in iMessage that tells you whether your opinion is actually worth betting on. Product spec: `Mayflower_Full_Product_and_Technical_Spec.md` (v2 is the source of truth). API references with sources: `docs/research/`.

## Run it (2 minutes, zero keys)

```bash
cp .env.example .env                  # fill in whatever keys you have; all optional
cd worker && npm i && npm run dev     # worker on :8787 (webhooks, pipeline, risk, executor, ticks)
cd web && npm i && npm run dev        # dashboard on :3000 (read-only)
cd worker && npm run chat -- +15551234567   # text Mayflower from your terminal
cd worker && npm test                 # risk engine tests
```

With no keys it still runs the full loop: real Gemini catalog (10k+ contracts, public, no key) → fake brain → real risk engine → APPROVE code → **simulated** fill → dashboard. `GET /health` and the dashboard strip show which integrations are live vs fallback. Never demo a fallback as live.

Try: `I have $200 I can risk, max $10 a trade` → `Seattle beats San Francisco this week` → (with `FAKE_FORECAST_DELTA=0.6` in .env to force an edge) `APPROVE <code>`.

## How it's built

One always-on **worker** (Node + TypeScript, `worker/`) does everything stateful. The **dashboard** (`web/`, Next.js) only reads the worker's `/api/*` JSON.

```
iMessage ─ BlueBubbles webhook ─┐
terminal ─ POST /dev/message ───┤
                                ▼
              pipeline/handle.ts  (per-user queue, dedupe, voice memo → text)
        ┌───────────┬───────────┴──────────────┐
   APPROVE 1234   onboarding                 belief
   approve.ts     brain.extractProfile       verdict.ts:
   atomic claim                               catalog.search → brain.match → catalog.quote
   → executor                                 → brain.research (Context.dev) → forecast → critique
   → orders/positions                         → core/risk.ts decide()  (plain code, tested)
                                              → verdict + proposal with APPROVE code
```

| Folder | What lives there | Real impl | Fallback (no key) |
|---|---|---|---|
| `worker/src/core/` | `types.ts`, `ports.ts` (interfaces), `api.ts` (dashboard contract), `risk.ts` (+tests) | — | — |
| `worker/src/pipeline/` | message routing, verdict flow, approval/execution, data helpers | — | — |
| `worker/src/gemini/` | catalog (prod + sandbox listings), executor, tick recorder | `SandboxExecutor` | `SimExecutor` (labeled SIMULATED) |
| `worker/src/brain/` | LLM, Context.dev, all prompts in `brain.ts` `prompts` | `GoogleLlm`, `ContextDevResearch` | `FakeLlm` heuristics, `NoResearch` |
| `worker/src/messaging/` | BlueBubbles send + webhook parse + register | `BlueBubblesMessenger` | `ConsoleMessenger` |
| `worker/src/voice/` | ElevenLabs STT/TTS | `ElevenLabsVoice` | `NoVoice` |
| `supabase/migrations/` | Postgres schema (12 tables), runs on boot | Supabase via `DATABASE_URL` | PGlite in `.data/` |
| `web/` | dashboard: `/` overview, `/case/[id]` case page | — | — |

**Rules the code enforces (don't break these):**
- The LLM proposes a probability; `core/risk.ts` decides verdict, side and size. Caps (per-trade, remaining budget, balance) can't be exceeded by anything the LLM says.
- Only `APPROVE <4 digits>` places an order. The claim is one conditional `UPDATE … WHERE status='pending' AND expires_at > now()`, so a code places at most one order, and codes are not reused for a user within 24h.
- Never show a fill Gemini didn't confirm. If the executor errors after sending, the order is `unknown`, not failed.
- Simulated fills are labeled everywhere (`sim_flag`, dashboard badge, reply text).

## ⚠ Gemini sandbox only lists crypto + commodities

Measured 2026-10-11: sandbox has 94 events (crypto 76, commodities 18), production has 500+ (sports 319, politics 124…). Public reads on production need no key, so discovery and research use real production markets. Orders go to the sandbox only for sandbox-listed contracts; everything else gets a **simulated fill at the live production price**, labeled as such. For real sandbox fills on camera, steer to BTC/ETH/SOL/oil beliefs (the BTC short-expiry contracts settle within the demo).

## Lanes for the team

The first milestone (spec v2): **a text from a phone produces a confirmed sandbox fill.**

1. **Messaging + voice:** BlueBubbles 1.9.9 is running on Kai's Mac behind a Cloudflare tunnel, and a real send through `BlueBubblesMessenger` took 797 ms (2026-10-11). On macOS 26 (Tahoe) chats are `any;-;<handle>`; the sender tries that first because `iMessage;-;` delivers but hangs. The free tunnel URL changes when BlueBubbles restarts. That Mac is signed into Kai's personal Apple ID, so `ALLOWED_SENDERS` (comma-separated phones/emails; `*` = everyone, empty = nobody) limits who the bot answers, and group chats are ignored; leave it set until a dedicated Mayflower Apple ID replaces the personal one. Texts from Kai's own iPhone arrive as `isFromMe` on the same account and are ignored, so live tests need a second phone. To wire it: set `BLUEBUBBLES_URL/PASSWORD/WEBHOOK_SECRET/ALLOWED_SENDERS`, run `npx tsx src/messaging/bluebubbles.ts` to register the webhook. Then do voice memos: check that ElevenLabs STT accepts iMessage `.caf` audio (it may need conversion), and send voice-note replies. Untested so far: every BlueBubbles + ElevenLabs HTTP call.
2. **Brain + risk:** add `GOOGLE_API_KEY` + `CONTEXT_DEV_API_KEY`, run real beliefs, and tune `prompts` in `brain/brain.ts` (matcher picking the right strike, research queries, critic). Free-tier `gemini-3.8-flash` may cap at ~20 requests/day and one verdict takes ~7 calls, so enable billing or use the flash-lite model. Then build monitoring + exit proposals, then hedges.
3. **Gemini + Radar:** sandbox key → `GEMINI_SANDBOX_*` → first real order (`SandboxExecutor` is untested; terms are accepted on boot). Build order reconciliation for resting orders (`orders@account` stream; today it only polls 8s). Confirm the tick recorder is saving trades, then build the Radar detector on `ticks` (3σ + 8pt 10-min move, one-sided volume).
4. **Dashboard + demo:** deploy `web/` to Vercel (`WORKER_URL`), the worker to Railway/Render with Supabase `DATABASE_URL` (PGlite won't survive a redeploy), case-page polish, street interviews.

## Known gaps (from the review gauntlet, not fixed yet)

- `/api/overview` is public: every user's belief text and positions are visible (phones are masked). Add a dashboard key before sharing the URL widely.
- Resting sandbox orders aren't re-checked after the first 8 seconds, so a later fill won't update the position.
- No recheck of budget at approval time (exposure is checked when the proposal is made; approved/working orders are reserved).
- `balance` is passed to the risk engine as unknown. Wire the real sandbox balance (`POST /v1/balances`).
- Fake mode's keyword matcher can pick the wrong strike ("BTC above 100k" → "$84,100 or above"). The real LLM matcher is what fixes this.
- `SandboxExecutor` has never run: the order body, status strings and `orders/history` fields come from the docs. Place one real sandbox order first (BTC short-expiry) and fix any field names. Unrecognized statuses map to `unknown`, not `open`.
- REST order placement has no client order id (only the WebSocket `order.place` takes one), so a lost response can't be matched to its order. Moving the executor to WS `order.place` fixes this.
- Orders are good-til-cancel. For the demo, immediate-or-cancel may be safer if Gemini supports it for prediction markets (unverified).
- The tick recorder subscribes in frames of 20 (larger frames are silently dropped). In testing it recorded very few trades and never saw a raw trade frame, so Radar's data source is unproven.
