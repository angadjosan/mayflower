# Mayflower

Your personal AI hedge fund for prediction markets. Talk to it over iMessage, approve each trade yourself through a link to that exact order, and see positions and the agent's reasoning on a small web dashboard.

## Run

```bash
npm install
cp .env.example .env.local   # every key is optional; see below
npm run dev                  # http://localhost:3000
```

With no keys set, every integration runs in a **mock or simulated mode, and the dashboard labels it as such**:

| Integration | Env | Without keys |
|---|---|---|
| Claude (LLM) | `ANTHROPIC_API_KEY` | heuristic profile parsing and forecasts |
| Gemini Exchange (sandbox) | `GEMINI_EXCHANGE_API_KEY/SECRET` | public market data if reachable, otherwise mock markets; simulated orders |
| Polymarket (fallback venue) | `POLYMARKET_PRIVATE_KEY` + `POLYMARKET_LIVE_TRADING=1` | public market data for markets Gemini doesn't list; simulated orders |
| Hyperliquid HIP-4 (fallback venue) | `HYPERLIQUID_PRIVATE_KEY` (testnet by default) | public outcome data for markets neither Gemini nor Polymarket lists; simulated orders |
| Context.dev | `CONTEXT_DEV_API_KEY` | `[mock]` citations |
| BlueBubbles (iMessage) | `BLUEBUBBLES_URL/PASSWORD` | web chat only |

## Layout

- `src/lib/types.ts`, `src/lib/db.ts`: domain types plus a JSON-file store (`.data/db.json`). It is meant to be swapped for Supabase later.
- `src/lib/llm.ts`, `exchange.ts`, `research.ts`: integration clients
- `src/lib/risk.ts`: deterministic sizing (capped fractional Kelly) and portfolio summary. The risk engine enforces limits, not the LLM.
- `src/lib/agent/`: profile extraction, discovery (personalized + general), research → forecast → critic, and chat intents
- `src/lib/execution.ts`: the **only** code path to `placeOrder`. It requires the proposal's token from the exact-order approval page.
- `src/lib/monitor.ts`: re-checks positions and proposes reduce/close actions. These still need your approval.
- `src/app/api/*`: chat, BlueBubbles webhook, state, discover, approve/reject, settings, cron monitor
- `src/app/approve/[id]`: signed exact-order confirmation page, linked from iMessage

See `docs/INTEGRATIONS.md` for setup.

## Security when exposed through a tunnel

The approval links and BlueBubbles webhook need a public URL (ngrok, cloudflared), which also exposes the dashboard. So:

- Signed out, the dashboard and its APIs fall back to the demo user **only for direct `localhost` requests**. Through the tunnel they return 401 and the page sends you to `/login` (a magic link over iMessage). `ALLOW_DEMO_USER=1` disables this check; don't use it when public.
- `/api/reset` and `/api/auth/dev-login` only answer direct localhost requests in dev.
- Set `BLUEBUBBLES_WEBHOOK_SECRET` and register the webhook as `.../api/bluebubbles/webhook?secret=...`. With BlueBubbles configured, the webhook refuses requests without it.
- Set `SESSION_SECRET` before `next start`.

## Demo script (what actually trades)

Checked on 2026-10-11: the Gemini **sandbox only lists crypto and commodity markets** (BTC/ETH/SOL price brackets, gold, oil). Production lists sports and politics, but sandbox can't trade them.

- **Real sandbox fill:** onboard with crypto or commodities interests, e.g. *"I follow Bitcoin and gold, I think BTC holds up this week, I can risk $200, conservative."* Proposals use sandbox instruments (`GEMI-...`) and an approved order goes to the sandbox, then gets reconciled from `orders/active` / `orders/history`.
- **Football from the spec:** set `GEMINI_DISCOVERY_INCLUDE_PRODUCTION=1`. Seahawks and other production markets are discovered from real public data, but their orders are **simulated and labeled paper-only**. Say so on stage.
- Sandbox books are sometimes empty (no quotes) for a few minutes around the hourly rollover. Discovery then falls back to labeled mock markets; wait a minute and retry.
- Leave the group-chat contests out of the main demo. They are beyond the spec, and the pitch is about trust.
- Run `npm test` for the risk engine tests.
