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

See `docs/INTEGRATIONS.md` for setup and for which endpoints are unverified.
