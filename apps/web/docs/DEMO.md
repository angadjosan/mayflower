# Two-minute demo (spec §11)

Pre-flight: `GOOGLE_API_KEY`, `CONTEXT_DEV_API_KEY`, `MAYFLOWER_EXCHANGE_MODE=sandbox` + sandbox key,
BlueBubbles reachable (`/api/health`). If iMessage is down, use the dashboard chat and say so.

| t | Action | Where it happens |
|---|---|---|
| 0–20s | Text: "I follow the Seahawks and AI, worried about a recession, I can risk $200, keep it conservative." | `profile.applyProfileMessage` → Settings shows interests + limits |
| 20–45s | Mayflower replies with one personalized + one general idea, each with "approve XXXX / why XXXX" | `discoverForUser` → proposals pending |
| 45–70s | "why XXXX" → thesis, for/against, estimate vs market, why $8, sources | `ask_why` intent; dashboard `/proposals/{id}` shows citations |
| 70–95s | "approve XXXX" → order sent to Gemini sandbox; reply quotes the venue's real status | `approveAndExecute`; never shown as filled unless the venue says so |
| 95–110s | Dashboard: position row, exposure chart, agent activity | `/` |
| 110–120s | Click "Check positions" (or wait for the 30-min job) → a *proposed* reduction appears, not an order | `monitorUser` → new proposal pending approval |

Safety talking points: approval binds to proposal version + hash; one order per approval; the DB forbids
the Fund Manager role; pause switch in Settings; every surface labelled sandbox/simulated.
