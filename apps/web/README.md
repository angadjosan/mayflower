# Mayflower — your personal AI hedge fund for prediction markets

Mayflower learns what you care about, researches the world, finds prediction-market
opportunities inside and outside your interests, sizes trades to your risk limits, and
asks you before placing anything. Talk to it over iMessage; see positions and reasoning
in a minimal web dashboard.

**Spec:** [`Mayflower_Full_Product_and_Technical_Spec.md`](./Mayflower_Full_Product_and_Technical_Spec.md)
**Docs:** [`docs/SETUP.md`](./docs/SETUP.md) · [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) · [`docs/DEMO.md`](./docs/DEMO.md) · [`docs/STATUS.md`](./docs/STATUS.md)

## Quick start (zero config, fully simulated)

```bash
npm install
npm run dev          # http://localhost:3000
npm test             # unit tests for risk, approval gate, adapters, pipeline
npm run typecheck
```

With no environment variables the app runs with a **mock LLM, mock research, simulated
exchange and in-memory database** — every surface is labelled accordingly. Add keys from
`.env.example` to light up each integration independently:

| Integration | Env | Status without it |
|---|---|---|
| Google Gemini (LLM) | `GOOGLE_API_KEY` | mock (scripted, tests only) |
| Context.dev research | `CONTEXT_DEV_API_KEY` | mock citations, clearly labelled |
| Gemini prediction markets | `MAYFLOWER_EXCHANGE_MODE=sandbox` + key | simulated venue |
| Supabase | `NEXT_PUBLIC_SUPABASE_URL` + keys | in-memory, resets on restart |
| iMessage (BlueBubbles) | `BLUEBUBBLES_URL/PASSWORD/WEBHOOK_SECRET` | web chat only |
| Trigger.dev jobs | `TRIGGER_SECRET_KEY` | run scans from the dashboard buttons |

## Repo layout

```
apps/web/                 Next.js 16 dashboard, chat, API routes, Trigger.dev tasks
packages/shared/          zod domain schemas (User, Thesis, Market, Proposal, Approval, Order, Position…)
packages/risk/            deterministic sizing (fractional Kelly + caps), exposure, hedges, exits, Sharpe
packages/agents/          LLM adapter (Google Gemini) + discovery / research / forecast / critic / monitor agents + pipeline
packages/context/         Context.dev research adapter (+ mock)
packages/gemini-markets/  Gemini prediction-markets REST adapter (+ simulated venue)
packages/messaging/       BlueBubbles iMessage channel, webhook parser, signed approval links
packages/db/              Repo interface, Supabase + in-memory implementations, credential encryption
packages/core/            Services: profile, proposals, approval gate, execution, portfolio, monitoring, conversation
supabase/migrations/      Postgres schema + RLS
docs/                     Setup, architecture, demo script, honest status
```

## Non-negotiables baked into the code

- **Nothing executes without an Approval** bound to an exact proposal version + hash (`packages/core/src/execution.ts`).
- **The risk engine, not the LLM, enforces limits** (`packages/risk/src/sizing.ts`).
- **One order per approval**, idempotent client order id; status is whatever the exchange returned.
- **Mayflower never holds funds**: only the Gemini Trader role is ever requested; the DB forbids `fund-manager`.
- **Honest labels**: every order/position carries `live | sandbox | simulated`; Sharpe is N/A until there is real history.
