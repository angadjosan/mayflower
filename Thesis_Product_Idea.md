# Thesis — Your Personal AI Hedge Fund

## The Idea

**Thesis is a consumer AI agent that turns your interests, beliefs, and knowledge of the world into researched prediction-market trades.** It continuously discovers opportunities, explains its reasoning, recommends how much to risk, and manages your portfolio. You remain in control: **every trade requires your approval before it is placed.**

Thesis is for people who have opinions about sports, technology, economics, politics, weather, and other real-world events but don't have the time or trading expertise to find relevant contracts, evaluate probabilities, or manage positions themselves.

The experience is simple: **talk to your agent over iMessage, approve trades, and view your positions and the agent's logic in a minimal web dashboard.**

## The Problem

Prediction markets let people take positions on real-world outcomes, but participating intelligently takes work. Users have to discover markets, interpret contract terms, follow developments, compare their own probabilities against prices, size trades, and monitor positions. Beginners often don't know what a sensible position size is or when to exit.

At the same time, people already have valuable context: topics they follow, events they care about, and opinions formed through their work, communities, and everyday lives. That context rarely translates into an organized investment process.

Thesis closes the gap between **what you know and believe** and **the prediction markets you might want to trade**, without requiring you to become a professional trader.

## Who It's For

- **Curious beginners:** People interested in prediction markets who want clear explanations and help managing risk.
- **People with strong interests:** Sports fans, technology enthusiasts, news followers, and others who know specific topics well.
- **Active prediction-market users:** People who want continuous research, trade discovery, and portfolio monitoring without doing everything manually.

## The Core Experience

### 1. Tell Thesis What You Believe

A user starts with a simple conversation, such as:

> "I follow the Seahawks closely, think AI infrastructure spending will keep growing, and I'm worried about a recession. I have $200 I can afford to risk."

Thesis learns the user's interests, beliefs, priorities, and risk preferences. Users can update these naturally over time: "I'm less confident about that now," or "Stop looking for political markets."

Personalization comes from two sources:

- **Direct input:** Conversations, stated opinions, interests, and trading preferences.
- **Optional connected context:** User-authorized sources such as email, Notion, Slack, or Discord, where appropriate and available. Connecting anything is optional; the product remains useful without it.

Personal context is used to surface relevant ideas, not to assume the user wants to trade everything they discuss. Users should be able to see and control what sources influence their recommendations.

### 2. Discover Opportunities, Even Beyond Your Interests

Thesis looks for trades in two complementary ways:

**Personalized discovery:** It searches for markets related to the user's interests, beliefs, and relevant developments. For example, a Seahawks fan may get a carefully researched football market suggestion.

**General opportunity discovery:** It also scans broader prediction markets for potentially interesting prices or developments, even if the user has never mentioned that topic. This prevents the agent from becoming trapped in the user's existing interests.

For every suggestion, Thesis answers:

- What exactly has to happen for this contract to win?
- Why is the market relevant or interesting now?
- What does the current market price imply?
- What probability does Thesis estimate, and why?
- What evidence supports or contradicts the idea?
- What could go wrong, including ambiguity in how the market resolves?

The agent can also decide **not to recommend a trade** when the evidence, price, or market conditions aren't compelling.

### 3. Research Before Recommending

Thesis researches current developments and explains its findings in plain English. Its recommendations should be grounded in sources rather than unsupported confidence.

Each trade idea includes a concise investment thesis, evidence for and against it, an estimated probability, the current market-implied probability, and an explanation of the potential upside and downside. The user can ask follow-up questions such as "Why do you think the market is wrong?" or "What would change your mind?"

The goal isn't to promise a winning prediction. It's to make the decision **understandable, evidence-based, and revisable**.

### 4. Recommend the Trade and Size the Risk

Thesis handles the financial concepts that most beginners don't know how to apply. It recommends **whether to trade, which side to take, how large the position should be, and how that position fits the rest of the portfolio**.

It considers:

- **Position sizing:** How much to commit based on available funds, estimated opportunity, uncertainty, and the user's risk limits.
- **Diversification and concentration:** Whether several positions depend on the same underlying outcome.
- **Hedging:** Whether an opposing or related position could meaningfully reduce exposure, and whether the protection is worth its cost.
- **Exit rules and stop-losses:** When to reconsider, reduce, or exit a position. Thesis explains that stop-loss orders or price alerts may not guarantee an exit at a specific price, particularly in thin markets.
- **Rebalancing:** Whether new information or changed market prices warrant adjusting existing positions.
- **Risk-adjusted performance:** Whether returns justify the risk taken. The dashboard may report measures such as a Sharpe ratio when enough meaningful return history exists, without presenting an unreliable number as authoritative.

**Every new trade or position-changing action requires explicit user approval.** Thesis can monitor and recommend actions automatically, but it does not silently place orders.

### 5. Approve Trades Through iMessage

The primary conversational experience is an iMessage-style exchange with the user's agent.

> **Thesis:** "I found a market related to your Seahawks outlook. The market implies a 42% chance; my research suggests 51%, although there's meaningful uncertainty. I'd suggest risking $8 of your $200 budget. Want to see why?"
>
> **You:** "Why only $8?"
>
> **Thesis:** "You already have exposure to related football outcomes, and the estimate isn't certain. A larger bet would concentrate too much of your budget."
>
> **You:** "Approve the $8 trade."
>
> **Thesis:** "I'll submit the approved order and update you on its status."

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
- Why Thesis chose that position size.
- What could invalidate the thesis and what the agent is watching.

**Actions**

- Review pending trade suggestions.
- Approve or reject specific trades or adjustments.
- Open a conversation with Thesis.

The dashboard complements iMessage: **messaging is where you talk to Thesis; the dashboard is where you see what it's thinking and what you own.**

### 7. Keep Watching After a Trade

Thesis doesn't disappear after execution. It continues monitoring news, market prices, contract developments, and the user's existing positions.

If the evidence changes, it tells the user what changed, how that affects the original thesis, and whether it recommends holding, reducing, closing, hedging, or rebalancing. It also tracks whether previous forecasts were accurate and communicates uncertainty rather than claiming perfect prediction.

Notifications should be selective: important changes and actionable recommendations, not constant noise.

## Example User Journey

1. A new user tells Thesis they follow football and AI, and sets a small trading budget.
2. Thesis finds one relevant football contract and one unrelated general-market opportunity.
3. The user asks why the football contract appears mispriced.
4. Thesis presents the supporting evidence, opposing evidence, estimated probability, and recommended position size.
5. The user approves a specific trade.
6. Thesis places the approved trade through Gemini and shows its actual status.
7. The position appears in the web dashboard with the original thesis and risk explanation.
8. New information changes the outlook. Thesis messages the user with a proposed adjustment, which requires a new approval.

## What Makes Thesis Different

**Personalized without being narrow.** It understands the user's interests but still searches the wider market for opportunities.

**Research, not just alerts.** It explains why a contract may be interesting, what the evidence says, and what could undermine the argument.

**Risk management for non-traders.** Users don't have to know how to size a position, evaluate correlation, think about hedges, or interpret risk-adjusted performance.

**Human-approved execution.** The agent does the work, but the user retains control over every trade.

**An ongoing relationship.** Thesis remembers stated preferences, follows open positions, and updates its recommendations as the world changes.

**A simple interface.** iMessage for conversation; a small dashboard for visibility and control.

## Hackathon MVP — Must Build

The hackathon version should prove the core product works end to end, rather than attempting every possible feature.

### Included

1. **Conversational onboarding:** The user provides interests, beliefs, budget, and risk preferences.
2. **Two kinds of discovery:** Thesis finds both personalized and general prediction-market opportunities.
3. **Live research:** Context.dev supplies current external evidence for recommendations.
4. **Gemini prediction markets:** Thesis finds relevant contracts, shows their market information, and submits user-approved trades in Gemini's sandbox.
5. **Explainable recommendations:** Each trade has a thesis, supporting and opposing evidence, estimated probability, and risk-based suggested size.
6. **Approval before execution:** The user reviews and explicitly authorizes each order.
7. **Minimal dashboard:** Show all positions, balances and performance, recommendation logic, risk sizing, and pending actions.
8. **Basic position monitoring:** Thesis notices meaningful changes and can recommend holding or adjusting positions.

### MVP Experience and Scope

The **web dashboard is essential** and should remain extremely simple. A conversational experience is also essential. **iMessage is the intended consumer messaging channel**, but full iMessage delivery is not a prerequisite for demonstrating the core MVP: if needed, demonstrate the same conversation inside the web experience and treat actual iMessage delivery as the next integration.

The MVP should demonstrate risk-aware sizing and explain why a trade is or isn't appropriate. Full portfolio hedging, advanced stop-loss workflows, rebalancing across many positions, and robust performance analytics belong to the broader product vision unless time permits.

All hackathon execution uses **Gemini sandbox funds**. A simulated order should be clearly labeled as simulated; a proposed order should not be displayed as filled until its status is confirmed.

## Future Features — Not Required for the MVP

### iMessage as the Full-Time Home

The agent becomes an ongoing personal contact. Users receive selective research updates, ask spontaneous questions, approve proposed trades, and discuss their portfolio directly in their messages.

### Optional Personal Context Connectors

Users can opt in to sources such as email, Notion, Slack, and Discord so Thesis better understands their interests and evolving beliefs. Users can disconnect sources and control what the agent uses. Private conversations should not automatically become trade instructions.

### Advanced Portfolio Management

More sophisticated portfolio-level hedging, concentration analysis, dynamic risk limits, exit recommendations, rebalancing, and meaningful long-term risk-adjusted performance reporting.

### Better Learning and Personalization

Over time, Thesis evaluates how its predictions performed, explains mistakes, learns which topics the user cares about, and improves how it communicates recommendations. Past wins are not treated as proof of future performance.

### Phone Calls with Thesis — ElevenLabs Stretch Feature Only

**If there's time at the very end**, users can call their agent and speak naturally about their portfolio, market developments, or pending trade recommendations. The call is another way to talk to the same agent, not a separate product. It is **not** an always-on microphone or passive recording feature. Any trade still requires clear, specific approval.

## Hackathon Sponsor Fit

- **Gemini — Core:** Prediction-market discovery, market information, and user-approved sandbox trading.
- **Context.dev — Core:** Research and monitoring of real-world developments that inform trade ideas.
- **YZi Labs — Product thesis:** Trusted consumer agents that can act on behalf of users while preserving user control, privacy, and clear authorization. This is a fit with the track's vision, not a claim that a separate onchain feature is part of the MVP.
- **ElevenLabs — Optional stretch:** The user can call Thesis by phone to speak with the agent.

**Not in scope:** AUSD, x402 payments, Ripple, an always-on recording assistant, automatic unapproved trades, and a complicated professional trading interface.

## The Pitch

> **Thesis is your personal AI hedge fund for prediction markets.** It learns what you care about, researches the world, finds opportunities both inside and outside your interests, and recommends risk-sized trades you can understand. Approve a trade over a conversation, then see every position, every reason, and every risk in one simple dashboard. Thesis keeps watching and tells you when the facts change—without ever trading behind your back.

## Product Principles

1. **The user approves every trade.** Monitoring and recommendations can be automatic; execution cannot.
2. **Show the reasoning.** Every recommendation needs a clear thesis, evidence, uncertainty, and position-size explanation.
3. **Manage downside, not just upside.** A trade can be interesting and still be too risky or too expensive.
4. **Keep it consumer-simple.** Hide complexity without hiding risk.
5. **Make no promises of profit.** Prediction-market contracts can lose their full cost, and estimates can be wrong.
6. **Build the real loop first.** Discovery → research → recommendation → approval → Gemini sandbox execution → portfolio visibility → monitoring.
