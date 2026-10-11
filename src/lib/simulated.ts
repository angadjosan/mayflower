// Paper bankroll each venue reports in simulated mode (no credentials / no live opt-in).
// Trade sizes are still capped by each user's risk limits (budget, per-trade, total exposure).
const n = Number(process.env.SIMULATED_BALANCE_USD);
export const SIMULATED_BALANCE_USD = Number.isFinite(n) && n > 0 ? n : 100_000;
