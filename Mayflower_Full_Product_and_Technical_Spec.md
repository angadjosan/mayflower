# Mayflower — Your Personal AI Hedge Fund

## The Idea

**Mayflower is a consumer AI agent that turns your interests, beliefs, and knowledge of the world into researched prediction-market trades.** It continuously discovers opportunities, explains its reasoning, recommends how much to risk, and manages your portfolio. You remain in control: **every trade requires your approval before it is placed.**

Mayflower is for people who have opinions about sports, technology, economics, politics, weather, and other real-world events but don't have the time or trading expertise to find relevant contracts, evaluate probabilities, or manage positions themselves.

The experience is simple: **talk to your agent over iMessage, approve trades, and view your positions and the agent's logic in a minimal web dashboard.**

## The Problem

Prediction markets let people take positions on real-world outcomes, but participating intelligently takes work. Users have to discover markets, interpret contract terms, follow developments, compare their own probabilities against prices, size trades, and monitor positions. Beginners often don't know what a sensible position size is or when to exit.

At the same time, people already have valuable context: topics they follow, events they care about, and opinions formed through their work, communities, and everyday lives. That context rarely translates into an organized investment process.

Mayflower closes the gap between **what you know and believe** and **the prediction markets you might want to trade**, without requiring you to become a professional trader.

## Who It's For

- **Curious beginners:** People interested in prediction markets who want clear explanations and help managing risk.
- **People with strong interests:** Sports fans, technology enthusiasts, news followers, and others who know specific topics well.
- **Active prediction-market users:** People who want continuous research, trade discovery, and portfolio monitoring without doing everything manually.

## The Core Experience

### 1. Tell Mayflower What You Believe

A user starts with a simple conversation, such as:

> "I follow the Seahawks closely, think AI infrastructure spending will keep growing, and I'm worried about a recession. I have $200 I can afford to risk."

Mayflower learns the user's interests, beliefs, priorities, and risk preferences. Users can update these naturally over time: "I'm less confident about that now," or "Stop looking for political markets."

Personalization comes from two sources:

- **Direct input:** Conversations, stated opinions, interests, and trading preferences.
- **Optional connected context:** User-authorized sources such as email, Notion, Slack, or Discord, where appropriate and available. Connecting anything is optional; the product remains useful without it.

Personal context is used to surface relevant ideas, not to assume the user wants to trade everything they discuss. Users should be able to see and control what sources influence their recommendations.

### 2. Discover Opportunities, Even Beyond Your Interests

Mayflower looks for trades in two complementary ways:

**Personalized discovery:** It searches for markets related to the user's interests, beliefs, and relevant developments. For example, a Seahawks fan may get a carefully researched football market suggestion.

**General opportunity discovery:** It also scans broader prediction markets for potentially interesting prices or developments, even if the user has never mentioned that topic. This prevents the agent from becoming trapped in the user's existing interests.

For every suggestion, Mayflower answers:

- What exactly has to happen for this contract to win?
- Why is the market relevant or interesting now?
- What does the current market price imply?
- What probability does Mayflower estimate, and why?
- What evidence supports or contradicts the idea?
- What could go wrong, including ambiguity in how the market resolves?

The agent can also decide **not to recommend a trade** when the evidence, price, or market conditions aren't compelling.

### 3. Research Before Recommending

Mayflower researches current developments and explains its findings in plain English. Its recommendations should be grounded in sources rather than unsupported confidence.

Each trade idea includes a concise investment thesis, evidence for and against it, an estimated probability, the current market-implied probability, and an explanation of the potential upside and downside. The user can ask follow-up questions such as "Why do you think the market is wrong?" or "What would change your mind?"

The goal isn't to promise a winning prediction. It's to make the decision **understandable, evidence-based, and revisable**.

### 4. Recommend the Trade and Size the Risk

Mayflower handles the financial concepts that most beginners don't know how to apply. It recommends **whether to trade, which side to take, how large the position should be, and how that position fits the rest of the portfolio**.

It considers:

- **Position sizing:** How much to commit based on available funds, estimated opportunity, uncertainty, and the user's risk limits.
- **Diversification and concentration:** Whether several positions depend on the same underlying outcome.
- **Hedging:** Whether an opposing or related position could meaningfully reduce exposure, and whether the protection is worth its cost.
- **Exit rules and stop-losses:** When to reconsider, reduce, or exit a position. Mayflower explains that stop-loss orders or price alerts may not guarantee an exit at a specific price, particularly in thin markets.
- **Rebalancing:** Whether new information or changed market prices warrant adjusting existing positions.
- **Risk-adjusted performance:** Whether returns justify the risk taken. The dashboard may report measures such as a Sharpe ratio when enough meaningful return history exists, without presenting an unreliable number as authoritative.

**Every new trade or position-changing action requires explicit user approval.** Mayflower can monitor and recommend actions automatically, but it does not silently place orders.

### 5. Approve Trades Through iMessage

The primary conversational experience is an iMessage-style exchange with the user's agent.

> **Mayflower:** "I found a market related to your Seahawks outlook. The market implies a 42% chance; my research suggests 51%, although there's meaningful uncertainty. I'd suggest risking $8 of your $200 budget. Want to see why?"
>
> **You:** "Why only $8?"
>
> **Mayflower:** "You already have exposure to related football outcomes, and the estimate isn't certain. A larger bet would concentrate too much of your budget."
>
> **You:** "Approve the $8 trade."
>
> **Mayflower:** "I'll submit the approved order and update you on its status."

Users can also message the agent to ask for updates, change their interests, request research, set risk preferences, or ask for a recommendation to close a position.

An approval is specific to a proposed action, amount, and contract. A general conversational statement is not treated as blanket permission to trade.

### 6. A Very Simple Web Dashboard

The dashboard is intentionally minimal. It's not a complex professional trading terminal. It should let a user understand their money and the agent's decisions in seconds.

**Portfolio overview**

- Total portfolio value, available balance, and realized/unrealized profit or loss.
- Overall risk exposure and a plain-English explanation of what drives it.
- Performance over time, with risk-adjusted metrics where meaningful.

**All positions**

- Market, YES/NO side, entry price, current price, amount invested, and current gain/loss.
- The agent's original reasoning and its latest assessment.
- Current risk, relevant hedge relationships, and any recommended adjustment.

**Agent logic**

- What evidence led to each recommendation.
- Estimated probability versus market-implied probability.
- Why Mayflower chose that position size.
- What could invalidate the thesis and what the agent is watching.

**Actions**

- Review pending trade suggestions.
- Approve or reject specific trades or adjustments.
- Open a conversation with Mayflower.

The dashboard complements iMessage: **messaging is where you talk to Mayflower; the dashboard is where you see what it's thinking and what you own.**

### 7. Keep Watching After a Trade

Mayflower doesn't disappear after execution. It continues monitoring news, market prices, contract developments, and the user's existing positions.

If the evidence changes, it tells the user what changed, how that affects the original thesis, and whether it recommends holding, reducing, closing, hedging, or rebalancing. It also tracks whether previous forecasts were accurate and communicates uncertainty rather than claiming perfect prediction.

Notifications should be selective: important changes and actionable recommendations, not constant noise.

## Example User Journey

1. A new user tells Mayflower they follow football and AI, and sets a small trading budget.
2. Mayflower finds one relevant football contract and one unrelated general-market opportunity.
3. The user asks why the football contract appears mispriced.
4. Mayflower presents the supporting evidence, opposing evidence, estimated probability, and recommended position size.
5. The user approves a specific trade.
6. Mayflower places the approved trade through Gemini and shows its actual status.
7. The position appears in the web dashboard with the original thesis and risk explanation.
8. New information changes the outlook. Mayflower messages the user with a proposed adjustment, which requires a new approval.

## What Makes Mayflower Different

**Personalized without being narrow.** It understands the user's interests but still searches the wider market for opportunities.

**Research, not just alerts.** It explains why a contract may be interesting, what the evidence says, and what could undermine the argument.

**Risk management for non-traders.** Users don't have to know how to size a position, evaluate correlation, think about hedges, or interpret risk-adjusted performance.

**Human-approved execution.** The agent does the work, but the user retains control over every trade.

**An ongoing relationship.** Mayflower remembers stated preferences, follows open positions, and updates its recommendations as the world changes.

**A simple interface.** iMessage for conversation; a small dashboard for visibility and control.

## Hackathon MVP — Must Build

The hackathon version should prove the core product works end to end, rather than attempting every possible feature.

### Included

1. **Conversational onboarding:** The user provides interests, beliefs, budget, and risk preferences.
2. **Two kinds of discovery:** Mayflower finds both personalized and general prediction-market opportunities.
3. **Live research:** Context.dev supplies current external evidence for recommendations.
4. **Gemini prediction markets:** Mayflower finds relevant contracts, shows their market information, and submits user-approved trades in Gemini's sandbox.
5. **Explainable recommendations:** Each trade has a thesis, supporting and opposing evidence, estimated probability, and risk-based suggested size.
6. **Approval before execution:** The user reviews and explicitly authorizes each order.
7. **Minimal dashboard:** Show all positions, balances and performance, recommendation logic, risk sizing, and pending actions.
8. **Basic position monitoring:** Mayflower notices meaningful changes and can recommend holding or adjusting positions.

### MVP Experience and Scope

The **web dashboard is essential** and should remain extremely simple. **iMessage is the full-time home for conversation**, delivered through a BlueBubbles server. The web chat mirrors the same conversation as a fallback if the bridge goes down, but iMessage is the primary experience we build and demo.

The MVP should demonstrate risk-aware sizing and explain why a trade is or isn't appropriate. Full portfolio hedging, advanced stop-loss workflows, rebalancing across many positions, and robust performance analytics belong to the broader product vision unless time permits.

All hackathon execution uses **Gemini sandbox funds**. A simulated order should be clearly labeled as simulated; a proposed order should not be displayed as filled until its status is confirmed.

## Future Features — Not Required for the MVP

### Optional Personal Context Connectors

Users can opt in to sources such as email, Notion, Slack, and Discord so Mayflower better understands their interests and evolving beliefs. Users can disconnect sources and control what the agent uses. Private conversations should not automatically become trade instructions.

### Advanced Portfolio Management

More sophisticated portfolio-level hedging, concentration analysis, dynamic risk limits, exit recommendations, rebalancing, and meaningful long-term risk-adjusted performance reporting.

### Better Learning and Personalization

Over time, Mayflower evaluates how its predictions performed, explains mistakes, learns which topics the user cares about, and improves how it communicates recommendations. Past wins are not treated as proof of future performance.

### Phone Calls with Mayflower — ElevenLabs Stretch Feature Only

**If there's time at the very end**, users can call their agent and speak naturally about their portfolio, market developments, or pending trade recommendations. The call is another way to talk to the same agent, not a separate product. It is **not** an always-on microphone or passive recording feature. Any trade still requires clear, specific approval.

## Hackathon Sponsor Fit

- **Gemini — Core:** Prediction-market discovery, market information, and user-approved sandbox trading.
- **Context.dev — Core:** Research and monitoring of real-world developments that inform trade ideas.
- **YZi Labs — Product thesis:** Trusted consumer agents that can act on behalf of users while preserving user control, privacy, and clear authorization. This is a fit with the track's vision, not a claim that a separate onchain feature is part of the MVP.
- **ElevenLabs — Optional stretch:** The user can call Mayflower by phone to speak with the agent.

**Not in scope:** AUSD, x402 payments, Ripple, an always-on recording assistant, automatic unapproved trades, and a complicated professional trading interface.

## The Pitch

> **Mayflower is your personal AI hedge fund for prediction markets.** It learns what you care about, researches the world, finds opportunities both inside and outside your interests, and recommends risk-sized trades you can understand. Approve a trade over a conversation, then see every position, every reason, and every risk in one simple dashboard. Mayflower keeps watching and tells you when the facts change—without ever trading behind your back.

## Product Principles

1. **The user approves every trade.** Monitoring and recommendations can be automatic; execution cannot.
2. **Show the reasoning.** Every recommendation needs a clear thesis, evidence, uncertainty, and position-size explanation.
3. **Manage downside, not just upside.** A trade can be interesting and still be too risky or too expensive.
4. **Keep it consumer-simple.** Hide complexity without hiding risk.
5. **Make no promises of profit.** Prediction-market contracts can lose their full cost, and estimates can be wrong.
6. **Build the real loop first.** Discovery → research → recommendation → approval → Gemini sandbox execution → portfolio visibility → monitoring.



---

# Concrete Build Specification (October 2026)

This section expands the product concept above into a specific implementation plan. **Product decisions are confirmed; implementation choices below are proposed defaults**, since we had not previously selected frameworks, databases, hosting, or connector vendors.

## 1. Final product boundaries

**Mayflower** is a consumer prediction-market copilot, not a business hedging platform. It uses both personal interests and general-market research to find opportunities. It explains each opportunity, recommends a position size, monitors risk, and asks permission before **every** order or portfolio-changing action.

**Two user interfaces:** a very simple web dashboard showing positions, agent reasoning, risk sizing, and proposed trades; and actual iMessage (via BlueBubbles) as the full-time home for conversations and notifications. A web chat mirrors the conversation as a fallback only.

**Core sponsor integrations:** Gemini Prediction Markets (trading) and Context.dev (research). **YZi Labs:** trusted-agent, user-controlled trading permissions and an optional BNB Chain testnet audit demonstration. **ElevenLabs:** final stretch feature only—users can call their agent. No AUSD, x402, Ripple, or always-on microphone.

**Trading mode:** Gemini sandbox during the hackathon. No live-money promises, guaranteed returns, or unapproved execution.

**Money:** Mayflower never holds user funds. Users fund their own Gemini account and link it to Mayflower with trade-only permissions (see §7).

## 2. Exact recommended stack

| Component | Selected stack | Responsibility |
|---|---|---|
| Language | TypeScript | Shared types across UI, services and integrations |
| Frontend | Next.js App Router, React | Web dashboard and chat |
| UI | Tailwind CSS, shadcn/ui | Minimal consumer design |
| Hosting | Vercel | Deploy web app and API |
| Database | Supabase Postgres | Users, beliefs, research, proposals, orders, positions, audit history |
| Authentication | Supabase Auth | Sign-in and authorization |
| AI reasoning | Google Gemini API, structured JSON responses | Extract beliefs, research, forecast and explain recommendations |
| Agent workflow | Custom typed state machine | Controlled discovery → research → risk → approval → execution |
| Research | Context.dev API | Search, retrieve, corroborate, monitor web evidence |
| Exchange | Gemini Prediction Markets API + official TypeScript SDK | Discover contracts, obtain prices, submit sandbox orders, track fills |
| Live updates | Gemini WebSocket where available; polling fallback | Quotes, orders, positions |
| Background jobs | Trigger.dev | Periodic market scans and monitoring |
| Risk math | TypeScript risk module | Expected value, sizing, concentration, exit and hedge analysis |
| Charts | Recharts | Minimal P&L and exposure visualizations |
| Error tracking | Sentry | Failures and observability |
| Messaging | iMessage via BlueBubbles Server on a dedicated always-on Mac | Inbound messages via webhook, outbound via BlueBubbles REST API |
| Exchange account linking | Gemini OAuth 2.0 (Trader role only) | Trade on the user's own Gemini account; no fund movement |
| YZi demonstration | BNB Smart Chain Testnet + viem (optional) | Hash-based approval-policy/audit receipts; no customer data onchain |
| Voice stretch | ElevenLabs conversational agent with phone integration | User calls Mayflower; same permissions as web |
| Repo | Public GitHub | Hackathon submission |

**Two separate Geminis:** Google Gemini is the LLM; Gemini Exchange is the prediction-market trading venue. Use separate API keys and clients.

**Validation gates:** Verify Gemini sandbox market coverage and exact order capabilities; Context.dev access and rate limits; BlueBubbles uptime and message delivery from the hosted Mac; whether Gemini OAuth works for prediction-market orders in sandbox, and which scopes it needs; and ElevenLabs inbound phone calling before claiming any feature works. Do not assume AUSD deposits into Gemini are supported.

## 3. Exact connectors and integration scope

| Integration | Data / actions | MVP status |
|---|---|---|
| Gemini Predictions | Markets, event rules, executable quotes, sandbox orders, fills, positions | P0, required |
| Context.dev | Current research, page retrieval, evidence citations, monitoring | P0, required |
| Google Gemini | Structured reasoning, thesis generation, probability estimates, explanation | P0, required |
| User-provided context | Interests, beliefs, budget, risk profile, excluded topics | P0, required |
| iMessage (BlueBubbles) | Primary conversation, alerts, secure links to approve proposals | P0, required |
| Gemini OAuth | Link the user's own Gemini account with trade-only permissions | P0, required (API-key fallback, see §7) |
| Web chat | Fallback mirror of the iMessage conversation | P1, fallback |
| Gmail/email | Opt-in newsletters, interests and event context | P2, future |
| Notion | Opt-in notes and personal research | P2, future |
| Slack | Opt-in relevant channels and messages | P2, future |
| Discord | Opt-in relevant communities and messages | P2, future |
| BNB Chain | Optional testnet commitment of policy and approval hashes | P2, YZi-specific |
| ElevenLabs | Inbound phone conversation with agent | P3, only after core product works |

Personal-context connectors must be explicitly authorized and revocable. Raw private messages should not be displayed in public research results or submitted indiscriminately to outside services. Connected information is **context**, not permission to trade.

**iMessage via BlueBubbles:** Apple does not offer a public cloud bot API for iMessage, so Mayflower runs BlueBubbles Server on a dedicated, always-on Mac signed into Mayflower's own Apple ID. BlueBubbles forwards new messages to our API by webhook, and we reply through its REST API. Expose the server through a stable tunnel, authenticate webhook calls, and map each sender's phone number or Apple ID to a Mayflower user. The Mac is a single point of failure: monitor it and fall back to web chat if it goes down. SMS is not the same thing. Sensitive approval should use a signed, expiring web confirmation bound to the exact order, rather than interpreting an ambiguous text such as “sure” as authorization.

## 4. User journeys

### First-time user

1. Text Mayflower in iMessage, or open the web app and sign in.
2. Say: “I follow the Seahawks and AI, and I have $200 I can risk.”
3. Set maximum loss per position, maximum total exposure, and topics to exclude.
4. Mayflower stores an editable profile of interests, beliefs, and risk limits.
5. Mayflower shows a personalized idea **and** a general-market idea, if real matching contracts exist.
6. Select a recommendation to see the thesis, counterarguments, sources, probability estimate, current price, and suggested size.
7. Ask “Why only $8?” in iMessage.
8. Approve the exact proposal. If no Gemini account is linked yet, Mayflower asks the user to link one now (see §7). Mayflower then submits the order to Gemini sandbox and shows the actual order status.
9. The position appears in the dashboard with its rationale and risk.
10. When evidence changes, Mayflower proposes an adjustment and asks for fresh approval.

### Returning user

- “What changed overnight?” → short summary of developments affecting open positions.
- “What are my riskiest positions?” → portfolio concentration and downside exposure.
- “Find opportunities outside sports.” → broad-market discovery.
- “Why are you recommending a hedge?” → explanation of offsetting outcomes and cost.
- “Sell half” → show exact order terms and request explicit approval; no silent execution.

## 5. What the dashboard shows

**Keep the page extremely simple.** No complicated trading terminal.

**Header:** total portfolio value, available funds, P&L, total at-risk amount / risk budget.

**Recommendations:** one concise card per opportunity showing market, side, current executable price, Mayflower probability, confidence, risk-sized amount, supporting and opposing evidence, and **Ask Why / Reject / Review & Approve**.

**All positions:** event, YES/NO side, quantity, entry price, current price, invested amount, unrealized/realized P&L, expiration, status, and risk exposure.

**Position detail:** original thesis, updated thesis, source links, forecast versus market price, why that size was selected, correlated positions, hedge ideas, stop/exit watch conditions, and all subsequent changes.

**Chat:** user asks questions or requests research and receives grounded explanations.

**Performance:** P&L and concentration first. Display Sharpe ratio as **N/A (insufficient history)** until enough consistent, genuine return observations exist; never invent a credible Sharpe ratio from a handful of sandbox orders.

## 6. Trading and risk-management rules

Users do not need to understand the terminology; Mayflower should do the calculations and explain them plainly.

**Research and forecast:** Only recommend contracts that actually exist on Gemini. Verify the event's resolution rules, expiry, liquidity, and market status. Use Context.dev to find both confirming and contradicting evidence, with timestamps and links. Estimate a probability independently of market price and disclose uncertainty. “No trade” is a valid recommendation.

**Expected value:** For a binary YES contract priced at $c and paying $1 if correct, approximate gross EV per contract as `estimated probability - executable purchase price`; fees, spread, slippage, and model error can eliminate apparent edge.

**Position sizing:** Enforce per-trade and total portfolio budget limits. Start with capped fractional-Kelly-style sizing, discount uncertain estimates, account for correlations, and never risk more than the user allows. Show the proposed dollar loss if the contract expires worthless. The risk engine—not the LLM—enforces limits.

**Hedging:** Identify genuinely offsetting markets, explain why they reduce exposure, quantify their cost and limitations, and propose a separate trade requiring approval. Do not label a loosely related contract a guaranteed hedge.

**Stop-losses:** In the MVP, define watch/exit triggers and **recommend** reducing or selling if they fire. An alert is not a guaranteed stop execution; thin markets and price gaps can prevent fills. Any sell still needs approval.

**Rebalancing:** Reassess concentrations and probabilities as evidence and prices change. Propose holding, reducing, closing, or hedging; each actual order needs a new approval.

**Sharpe ratio:** Use only with meaningful periodic portfolio-return history; otherwise display N/A. It measures excess return per unit of volatility, not the chance a single trade wins.

**Security:** Keep exchange secrets server-side and encrypted, apply per-user access controls, require exact order confirmation, deduplicate submissions, log every agent action, and expose a pause/kill switch. Never present an order as filled until the exchange confirms the fill.

## 7. Funding & accounts

**Mayflower never touches user money.** There is no deposit into Mayflower, no pooled account, and no payments integration for trading funds.

1. **Funding happens in Gemini.** The user funds their own Gemini account in the Gemini app (ACH, wire, or debit card, per Gemini's own flows). Mayflower does not build a deposit flow.
2. **Linking uses Gemini OAuth.** The user taps "Connect Gemini" and grants read access to balances and positions plus the **Trader** role. Mayflower never requests the **Fund Manager** role, so it can place approved trades but cannot move or withdraw money.
3. **Link at first trade, not at signup.** Onboarding starts in iMessage with interests, beliefs, and risk limits. Mayflower asks the user to link Gemini only when they approve their first trade. New users without a Gemini account are sent to sign up and then return.
4. **"Budget" is a risk limit, not a deposit.** The user's "$200 I can risk" is stored as a Mayflower limit. The risk engine reads the real Gemini balance and keeps total exposure under both the limit and the available balance.
5. **Profits and withdrawals stay in Gemini.** Mayflower displays P&L but never initiates a withdrawal.

**Why not hold funds:** Prediction-market contracts are CFTC-regulated. Pooling customer money to trade on their behalf would look like operating a commodity pool or acting as a broker, and would add KYC, custody, refund, and tax obligations. Trade-only delegation is also the core of the YZi trust story: the agent can act, but it cannot move your money.

**Hackathon setup (sandbox):**

- **Plan A:** each demo user links a Gemini sandbox account via OAuth (the real flow).
- **Plan B:** if OAuth is unavailable in sandbox, use one team sandbox API key stored server-side, track each user's allocation in a Supabase ledger, and label it **"Sandbox – shared account"** in the dashboard.
- Gemini OAuth tokens are encrypted at rest and revocable; Mayflower stores no card or bank details.

**Business model:** free during the hackathon; later, a Mayflower subscription billed through Stripe (for Mayflower itself, never for trading funds). No per-trade cut, which would raise the same regulatory issues as holding funds.

## 8. Agent workflow

```text
User interests + optional personal context
                |
       Personalized discovery ------- General market scan
                |                              |
                +---- Gemini contract catalog -+
                               |
                     Contract validation
                               |
                 Context.dev source research
                               |
               Google Gemini forecast + critic
                               |
                  Deterministic risk sizing
                               |
                Proposal + sources + rationale
                               |
                  EXPLICIT USER APPROVAL
                               |
                 Gemini sandbox execution
                               |
                 Fill/order reconciliation
                               |
              Positions + dashboard + audit log
                               |
                  Ongoing monitoring/alerts
```

Suggested agent responsibilities:

- **Discovery agent:** finds real, tradable contracts and ranks relevance.
- **Research agent:** gathers sourced evidence through Context.dev.
- **Forecast agent:** produces a probability and uncertainty with reasons.
- **Critic:** challenges the recommendation, catches resolution mismatches and weak evidence.
- **Risk engine:** deterministic sizing, budget and concentration checks.
- **Execution service:** acts only on approved, valid proposals.
- **Monitor:** watches existing positions and recommends changes.

Do not let the LLM call order placement directly without the approval gate and deterministic checks.

## 9. Data model

| Entity | Essential fields |
|---|---|
| User | id, authentication, iMessage handle (phone/Apple ID), settings, risk limits |
| GeminiConnection | user, OAuth token (encrypted), granted scopes/roles, status, linked_at, revoked_at |
| UserThesis | user, topic, belief, confidence, source, updated_at |
| ConnectedSource | user, provider, scopes, status |
| Market | Gemini market ID, event, settlement rules, expiry, status |
| MarketQuote | market ID, timestamp, bid, ask, liquidity |
| ResearchReport | market, citations, evidence for/against, estimated probability, uncertainty |
| TradeProposal | user, market, side, quantity, limit price, risk snapshot, expiry, status |
| Approval | user, exact proposal version, timestamp, decision |
| Order | exchange order ID, submitted terms, status, fills, errors |
| Position | user, market, side, quantity, cost basis, P&L, risk |
| MonitorEvent | position, trigger, evidence, recommendation, notification |
| AuditEvent | actor, action, time, reference to proposal/order and result |

**Suggested repo:**

```text
mayflower/
  apps/web/                 # Next.js dashboard, chat, API
  packages/agents/          # Discovery, research, forecast, critic
  packages/gemini-markets/  # Gemini Exchange integration
  packages/context/         # Context.dev research
  packages/risk/            # Sizing, hedges, exposure, exit proposals
  packages/shared/          # Schemas and types
  supabase/migrations/      # Postgres schema and policies
  docs/                     # Product, demo and setup notes
```

## 10. MVP versus future roadmap

### P0 — Must work for the hackathon

- Conversational onboarding over iMessage (BlueBubbles).
- Gemini account linking via OAuth (trade-only), with the shared-sandbox fallback.
- Persistent user interests, beliefs, and risk budget.
- Gemini sandbox contract discovery and current quotes.
- Personalized **and** general-market opportunity discovery.
- Context.dev-grounded research with clickable citations.
- Probability estimates, counterarguments, and transparent risk sizing.
- A working approval gate and **actual Gemini sandbox order submission**.
- Order status and all positions in the simple dashboard.
- iMessage alerts and basic monitoring/recommendation updates.

### P1 — Strong additions if P0 is stable

- Web chat fallback mirroring the iMessage conversation.
- Position-level stop/exit alerts and rebalance suggestions.
- Basic portfolio correlation/hedge proposals.
- More polished portfolio performance views.

### P2 — Future product / optional YZi submission enhancement

- Gmail, Notion, Slack, and Discord personal-context connectors.
- BNB Chain testnet commitments for hashed user trading policies or approval receipts, **without storing private content onchain**.
- Historical forecast scoring and calibration.
- Richer multi-position hedging and risk analytics.

### P3 — ElevenLabs stretch, **last**

- User calls Mayflower by phone to discuss positions and opportunities.
- Same backend research, risk policies, and approval process.
- No always-on recording or unsolicited calls.

## 11. Demo script (two minutes)

**0–20 seconds:** User says they follow football and AI, have a $200 budget, and want conservative sizing. Profile appears.

**20–45 seconds:** Mayflower finds one relevant Gemini contract plus a general-market candidate. Context.dev supplies evidence and counterarguments.

**45–70 seconds:** Open the recommendation: market odds, Mayflower probability, why the size is $8, maximum downside, and cited sources.

**70–95 seconds:** User approves the exact order. Show Gemini sandbox response and resulting order/fill state. Do not fake a fill.

**95–110 seconds:** Dashboard shows the position, thesis, risk and P&L.

**110–120 seconds:** A new evidence update triggers a proposed adjustment, **not** an unauthorized trade.

Run the conversation in iMessage. If the BlueBubbles Mac is down, switch to the web chat fallback and say so.

## 12. Sponsor positioning

**Gemini Prediction Markets — primary:** Genuine market discovery, contract research, live pricing, and approved sandbox order execution.

**Context.dev — primary:** Research pipeline that supplies sourced, current evidence, including contradictory findings and updates.

**YZi Labs — target:** Trustworthy consumer financial agents with delegated **analysis** but explicit user authorization for money movement. Optional BNB testnet audit receipt if time permits; do not imply an onchain feature exists when it has not been built.

**ElevenLabs — stretch:** Phone-call access to the same agent, only after the core workflow is stable.

## 13. Acceptance criteria

- A new user can onboard without knowing how to trade.
- The app discovers real contracts rather than hardcoded demo markets.
- At least one recommendation has verifiable external citations and opposing evidence.
- The risk engine shows and enforces an actual user-defined maximum.
- An unapproved order **cannot** be submitted.
- Mayflower holds no user funds and its Gemini access cannot withdraw or transfer money.
- An approved sandbox order is sent once and reconciled with Gemini's returned status.
- The dashboard displays real stored positions and the logic behind them.
- The agent can recommend no trade and can propose a position change without executing it.
- Every feature is labeled honestly: live, sandbox, simulated, or not yet implemented.

## 14. Final pitch

> **Mayflower is your personal AI hedge fund for prediction markets.** It learns what you care about, researches the world, discovers opportunities both inside and outside your interests, and recommends trades sized to your risk. Talk to it in iMessage, approve each trade yourself, and see every position, every reason, and every risk in a simple dashboard. It keeps watching after you buy—and never trades behind your back.
