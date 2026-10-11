// Mark-to-market: refresh every open position's current price and snapshot portfolios, so the
// dashboard value and chart move with the market. Runs on every tick (~30s).
import { load, tx, now } from "./db";
import { getMarket } from "./exchange";
import { recordSnapshot } from "./risk";
import type { Market, Side } from "./types";

const SNAPSHOT_EVERY_MS = (Number(process.env.SNAPSHOT_EVERY_SEC) || 60) * 1000;

/** Fair mark for a side: bid/ask midpoint, else whichever side of the book exists. */
export function markFor(m: Market, side: Side): number | undefined {
  const [bid, ask] = side === "YES" ? [m.yesBid, m.yesAsk] : [m.noBid, m.noAsk];
  if (bid != null && ask != null) return +((bid + ask) / 2).toFixed(4);
  return bid ?? ask ?? (side === "YES" ? m.lastPrice : m.lastPrice != null ? 1 - m.lastPrice : undefined);
}

export async function refreshMarks(): Promise<{ marked: number; snapshots: number }> {
  const db0 = await load();
  const open = db0.positions.filter((p) => p.status === "open");
  const markets = new Map<string, Market | undefined>();
  await Promise.all([...new Set(open.map((p) => p.marketId))].map(async (id) => {
    markets.set(id, await getMarket(id).catch(() => undefined));
  }));
  const marked = await tx((db) => {
    let n = 0;
    for (const p of db.positions) {
      if (p.status !== "open") continue;
      const m = markets.get(p.marketId);
      const px = m ? markFor(m, p.side) : undefined;
      if (px == null || px === p.currentPrice) continue;
      p.currentPrice = px;
      p.updatedAt = now();
      n++;
    }
    return n;
  });
  // Snapshot users with open positions at most once per SNAPSHOT_EVERY_MS.
  let snapshots = 0;
  for (const userId of new Set(open.map((p) => p.userId))) {
    const last = db0.snapshots.filter((s) => s.userId === userId).at(-1);
    if (last && Date.now() - Date.parse(last.at) < SNAPSHOT_EVERY_MS) continue;
    await recordSnapshot(userId);
    snapshots++;
  }
  return { marked, snapshots };
}
