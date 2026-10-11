# Honest feature status (spec §13: "every feature is labelled")

| Area | Status | Notes |
|---|---|---|
| Conversational onboarding | **built** | needs `GOOGLE_API_KEY`; mock LLM in tests |
| Personalized + general discovery | **built** | LLM ranking over exchange catalog; ≥1 general candidate kept |
| Context.dev research with citations | **built, verified against OpenAPI** | search + scrape; monitors adapter present, not scheduled |
| Forecast + critic + no-trade | **built** | critic can block on resolution mismatch |
| Deterministic risk sizing | **built + tested** | Kelly fraction, per-position, budget, theme caps, balance cap |
| Approval gate | **built + tested** | version/hash/expiry/duplicate checks; signed links for ambiguous text |
| Gemini sandbox execution | **built, not yet exercised against sandbox with real keys** | REST shapes verified from official spec; terms gate; idempotent via clientOrderId |
| Order reconciliation | **built (polling)** | WS stream is an opening |
| Positions + P&L | **built** | unrealized from mid quote |
| Dashboard | **built** | header KPIs, recommendations, positions, agent logic, chat, exposure chart |
| Web chat fallback | **built** | same history as iMessage |
| iMessage via BlueBubbles | **built, not yet tested against a live Mac** | webhook parser tested against documented payload |
| Monitoring + adjustment proposals | **built (basic)** | drawdown/expiry triggers + fresh evidence; proposes SELL needing approval |
| Trigger.dev scheduled jobs | **built** | scan 6h, monitor 30m |
| Supabase schema + repo | **built, migration not yet applied anywhere** | RLS + constraints; in-memory default |
| Gemini OAuth (Plan A) | **built, unverified** | auth-code flow; refresh rotation is an opening |
| API-key linking (Plan A fallback) | **built** | AES-GCM at rest |
| Shared sandbox (Plan B) | **built** | labelled "Sandbox – shared account" |
| Sharpe ratio | **N/A by design** | needs periodic return history |
| Hedging / rebalancing | **basic** | opposite-side same-theme detection only |
| Connectors (Gmail/Notion/Slack/Discord) | **not implemented** | schema + UI placeholders |
| BNB testnet receipts | **not implemented** | described as opening |
| ElevenLabs voice | **stub route only** | returns 501 until configured |
| Sentry | **not wired** | env placeholder |
