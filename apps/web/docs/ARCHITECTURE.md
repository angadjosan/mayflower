# Architecture

```
iMessage (BlueBubbles webhook) ─┐
Web chat (/api/chat) ───────────┼─▶ core/conversation.handleUserMessage
Voice stub (/api/voice) ────────┘        │ classifyIntent (LLM, fast)
                                         ├─ onboard → profile.applyProfileMessage → discoverForUser
                                         ├─ find_opportunities → proposals.discoverForUser
                                         ├─ approve → execution.approveAndExecute (or signed link)
                                         ├─ ask_why / portfolio_status / what_changed / pause …
                                         └─ composeReply (LLM) → channel.send

discoverForUser (packages/core/proposals.ts)
  └─ agents/pipeline.runDiscoveryPipeline
       discovery (exchange catalog + LLM ranking, excluded topics, personalized + general)
       → validateMarket (open, quoted, not expired)
       → research.gatherEvidence (Context.dev: for/against/latest queries)
       → forecast (LLM deep, independent probability + uncertainty)
       → critic (LLM fast: blockers, resolution mismatch, adjustments)
       → risk.sizePosition (DETERMINISTIC: uncertainty discount, fractional Kelly, caps)
       → Opportunity{ recommendation | noTradeReason }
  └─ persistOpportunity → TradeProposal(status=pending_approval, bindingHash)

Approval gate (packages/core/execution.ts)
  recordDecision: version match, not expired, hash intact, one decision per version
  executeApproved: one Order per Approval (clientOrderId = approval id), venue status as-is
  reconcileOrder: poll venue, apply fills to Position

Monitoring (packages/core/monitoring.ts, agents/monitor.ts)
  refresh quotes → deterministic exit signals (drawdown, expiry) → fresh evidence → LLM assessment
  → MonitorEvent (+ SELL proposal for reduce/close, requiring NEW approval)
```

## Boundaries that matter
- `packages/shared` is the only place types live; every integration validates with zod at the edge.
- `ExchangeClient`, `ResearchProvider`, `LLM`, `Repo`, `OutboundChannel` are the five seams. Each has a
  real and a mock/simulated implementation; `core/container.ts` picks per environment and reports status.
- The LLM never sees order-placement tools. It emits JSON that the risk engine and approval gate consume.

## Data model
See `supabase/migrations/0001_init.sql` — one table per spec §9 entity, RLS "own rows" everywhere, a
check constraint forbidding the `fund-manager` role, unique `(approval_id)` on orders and
`(proposal_id, proposal_version)` on approvals to make double-execution impossible at the DB layer too.

## Openings (designed to be extended)
- **Discovery ranking**: keyword prefilter + LLM ranking over ≤60 markets. Swap in embeddings / categories.
- **Correlation**: tag overlap. Replace `risk/portfolio.areCorrelated` with a learned or event-graph model.
- **Hedging**: only exact opposite-side same-theme positions count. Add cross-market hedge search + cost.
- **Exit policy**: drawdown + expiry window. Add per-market volatility, liquidity-aware stops.
- **Sharpe / performance**: `portfolio_snapshots` table + daily job → `sharpeRatio()` already handles it.
- **Research**: three query templates. Add scrape-and-read of top hits, Context.dev monitors per position.
- **Connectors (Gmail/Notion/Slack/Discord)**: `ConnectedSource` schema + settings placeholders exist; add OAuth + a `ContextConnector` that yields `UserThesis` candidates with `source="connector"`.
- **BNB testnet receipts (YZi)**: hash `Approval` rows and commit with viem; nothing onchain yet.
- **ElevenLabs**: `/api/voice/webhook` reuses the conversation handler; voice never approves directly.
- **Auth**: Supabase Auth session is honoured; add a sign-in page + `proxy.ts` to require it.
- **Realtime**: Gemini WS (`wss://ws.sandbox.gemini.com`, `orders@account`) to replace polling in `reconcileOrder`.
