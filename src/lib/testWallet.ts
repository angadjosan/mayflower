// Per-user Hyperliquid TEST wallet: a real EVM keypair (key encrypted at rest) with a testUSDC balance that
// Mayflower tracks. Everything is testnet: fills happen at real Hyperliquid testnet prices, money is test money.
// (Hyperliquid's own faucet only gives ~1k per claim, so the 100k starting balance is ledgered here.)
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { tx, load, audit, type DB } from "./db";
import { encryptJSON } from "./crypto";

export const TEST_USDC_GRANT = Number(process.env.TEST_USDC_GRANT) > 0 ? Number(process.env.TEST_USDC_GRANT) : 100_000;

export interface TestWallet { address: string; keyEnc: string; usdc: number; createdAt: string }
type WithWallet = { testWallet?: TestWallet };

/** Create the user's test wallet on first use and credit the testUSDC grant. */
export async function ensureTestWallet(userId: string): Promise<TestWallet> {
  const existing = ((await load()).users.find((u) => u.id === userId) as WithWallet | undefined)?.testWallet;
  if (existing) return existing;
  const key = generatePrivateKey();
  const fresh: TestWallet = { address: privateKeyToAccount(key).address, keyEnc: encryptJSON({ key }), usdc: TEST_USDC_GRANT, createdAt: new Date().toISOString() };
  const w = await tx((db) => {
    const u = db.users.find((x) => x.id === userId) as (WithWallet & { id: string }) | undefined;
    if (!u) throw new Error("unknown user");
    u.testWallet ??= fresh; // another request may have created it first
    return u.testWallet;
  });
  if (w === fresh) await audit({ userId, actor: "system", action: "test_wallet.created", detail: { address: w.address, testUsdc: w.usdc } });
  return w;
}

export function walletOf(db: DB, userId: string): TestWallet | undefined {
  return (db.users.find((u) => u.id === userId) as WithWallet | undefined)?.testWallet;
}

/** Inside a tx: move testUSDC (negative = spend). */
export function adjustTestUsdc(db: DB, userId: string, delta: number) {
  const w = walletOf(db, userId);
  if (w) w.usdc = +(w.usdc + delta).toFixed(6);
}
