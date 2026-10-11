# Exchange setup: Gemini, Polymarket, Hyperliquid

How to get each trading venue working, beyond creating accounts and pasting keys. For how the code works, see `docs/INTEGRATIONS.md`.

## How trades are routed

Gemini is the primary venue. A market is only traded on **Polymarket** when Gemini doesn't list it, and on **Hyperliquid** when neither Gemini nor Polymarket lists it. Each venue runs in one of these modes:

| Venue | Without keys | With keys | Real money? |
|---|---|---|---|
| Gemini | simulated | sandbox | No (sandbox) |
| Polymarket | simulated (real prices, fake fills) | live, **only** with `POLYMARKET_LIVE_TRADING=1` | **Yes**, it has no test environment |
| Hyperliquid | simulated | testnet (default) | Only with `HYPERLIQUID_NETWORK=mainnet` + `HYPERLIQUID_LIVE_TRADING=1` |

The dashboard header and every proposal show which venue and mode a trade uses.

**Recommended setup:** Gemini sandbox + Hyperliquid testnet with real keys, and Polymarket left simulated, so you get its real prices without risking money.

## What each venue uses

| Venue | Currency | Wallet / account |
|---|---|---|
| Gemini | USD | One **shared** Gemini sandbox account behind `GEMINI_EXCHANGE_API_KEY`. All users trade through it unless per-user Gemini OAuth is configured. |
| Polymarket | USDC.e (bridged USDC) on Polygon | The wallet for `POLYMARKET_PRIVATE_KEY`, or the Polymarket.com proxy wallet at `POLYMARKET_FUNDER_ADDRESS` |
| Hyperliquid | Each outcome market's quote stablecoin: USDC, or possibly USDH. The code reads it per market. | The wallet for `HYPERLIQUID_PRIVATE_KEY`, or the master account at `HYPERLIQUID_ACCOUNT_ADDRESS` when that key is an API (agent) wallet |

## Simulated balance

In simulated mode each venue reports a paper balance of `SIMULATED_BALANCE_USD` (default **$100,000**).

## Things to do everywhere

1. **Raise each user's risk limits.** These caps decide trade size, not the balance. New users start with a **$200 budget, $20 max per trade, and $100 max at risk**, so even a $100k balance produces $20 trades. Limits can be raised up to $100,000 in the dashboard settings, or by telling the bot in chat.
2. **Push env vars to Vercel.** Fill in `.env.local`, run `vercel link`, then `scripts/vercel-env-push.sh`.
3. **Place one tiny test trade per venue first.** The Polymarket and Hyperliquid integrations were written against the official clients and SDK types, but the dev environment couldn't reach either API, so neither has made a live call yet.

## Gemini (sandbox)

- Create the account at https://exchange.sandbox.gemini.com. Add fake USD with the sandbox site's deposit/top-up option; this is the only venue where a large test balance is easy.
- Create an API key **with the Trading role**. Set `GEMINI_EXCHANGE_API_KEY` and `GEMINI_EXCHANGE_API_SECRET`.
- If the key was created with a **time-based** nonce, set `GEMINI_EXCHANGE_NONCE=seconds`. Leave it blank for incremental.
- If it's a **master** key, set `GEMINI_EXCHANGE_ACCOUNT` to the sub-account name (default `primary`).
- The prediction-market terms are accepted automatically on the first order.
- The sandbox **only lists crypto and commodity markets**. Sports, politics and other topics fall through to Polymarket and Hyperliquid. `GEMINI_DISCOVERY_INCLUDE_PRODUCTION=1` also lists Gemini production markets, but only as paper trades.

## Polymarket (real money only)

Leave this simulated unless you really mean to trade real USDC.

- **Geo-blocking applies to the server, too.** Polymarket's international exchange blocks the US and some other jurisdictions. Vercel runs functions in a **US region by default** (`iad1`), so orders would be rejected even if you aren't in the US. To trade live you'd have to deploy the functions to an allowed non-US region, and only if you're actually permitted to use Polymarket where you are.
- **Polymarket.com account (easiest):**
  - set `POLYMARKET_SIGNATURE_TYPE=1` (email/Magic login) or `2` (browser wallet)
  - set `POLYMARKET_FUNDER_ADDRESS` to your Polymarket deposit/proxy address
  - set `POLYMARKET_PRIVATE_KEY` to the key that controls it

  The website sets the token approvals when you first enable trading.
- **Plain wallet (`POLYMARKET_SIGNATURE_TYPE=0`):**
  - fund it with USDC.e on Polygon, plus a little POL for gas
  - send the one-time on-chain approvals yourself: USDC.e and the Conditional Tokens contract, for the CTF Exchange and Neg-Risk CTF Exchange

  **The app does not send these approvals.**
- API credentials are derived automatically from the private key. You can also set `POLYMARKET_API_KEY`, `POLYMARKET_API_SECRET` and `POLYMARKET_API_PASSPHRASE`.
- Set `POLYMARKET_LIVE_TRADING=1`. Without it, Polymarket stays simulated.
- Most markets require at least **5 contracts** per order. Smaller ideas are skipped.
- `POLYMARKET_ENABLED=0` turns the venue off completely.

## Hyperliquid (HIP-4 outcome markets, testnet by default)

- Create a **dedicated test wallet** and set `HYPERLIQUID_PRIVATE_KEY`. The network defaults to testnet.
- Get test USDC from the testnet faucet in the Hyperliquid testnet app. As far as we know it gives about 1,000 per claim, and it may require the address to have made a deposit on mainnet before. Large test balances aren't practical.
- If the outcome markets settle in **USDH** instead of USDC, swap test USDC into USDH on testnet first. We couldn't confirm which quote token the markets use.
- If you use an **API (agent) wallet**:
  - approve it in the Hyperliquid app first
  - set `HYPERLIQUID_ACCOUNT_ADDRESS` to the main account, which holds the funds and the orders
- `HYPERLIQUID_DISCOVERY_INCLUDE_MAINNET=1` also lists mainnet outcomes while on testnet, as paper trades.
- Mainnet (real money) needs both `HYPERLIQUID_NETWORK=mainnet` and `HYPERLIQUID_LIVE_TRADING=1`.
- Any exchange-side minimum order size is enforced by Hyperliquid. Rejections show up on the order.
- `HYPERLIQUID_ENABLED=0` turns the venue off completely.
