// YZi: hash-based audit receipts committed to BNB Smart Chain testnet.
// Only a sha256 hash goes onchain (as calldata of a 0-value self-transfer). The canonical record stays
// offchain in our audit log so anyone holding it can recompute the hash and compare it with the tx.
import crypto from "crypto";
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";
import { tx, load, id, now, audit } from "./db";
import type { AuditReceipt, TradeProposal } from "./types";

export const BSC_TESTNET_EXPLORER = "https://testnet.bscscan.com/tx/";
const RPC = process.env.BNB_TESTNET_RPC || "https://data-seed-prebsc-1-s1.bnbchain.org:8545";
const PREFIX_HEX = Buffer.from("mayflower:", "utf8").toString("hex");
const RECORD_ACTION = "receipt.record";

export const receiptsOnchainEnabled = () => Boolean(normalizedKey());

function normalizedKey(): Hex | undefined {
  const k = process.env.BNB_TESTNET_PRIVATE_KEY?.trim();
  if (!k) return undefined;
  const hex = k.startsWith("0x") ? k : `0x${k}`;
  return /^0x[0-9a-fA-F]{64}$/.test(hex) ? (hex as Hex) : undefined;
}

/** Deterministic JSON: object keys sorted recursively, no whitespace. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
    .join(",")}}`;
}

export const sha256Hex = (s: string) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

/** Keyed hash of the user id so the record never carries a raw account identifier. */
export function userIdHash(userId: string): string {
  const key = process.env.SESSION_SECRET || "mayflower-receipts";
  return crypto.createHmac("sha256", key).update(`user:${userId}`).digest("hex");
}

export const receiptCalldata = (hash: string): Hex => `0x${PREFIX_HEX}${hash}` as Hex;

// Serialize sends so concurrent commits don't race for the same nonce.
let sendQueue: Promise<unknown> = Promise.resolve();
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = sendQueue.then(fn, fn);
  sendQueue = run.catch(() => undefined);
  return run;
}

async function broadcast(hash: string): Promise<Hex> {
  const key = normalizedKey();
  if (!key) throw new Error("BNB_TESTNET_PRIVATE_KEY not set or invalid");
  const account = privateKeyToAccount(key);
  const wallet = createWalletClient({ account, chain: bscTestnet, transport: http(RPC) });
  return enqueue(() => wallet.sendTransaction({ to: account.address, value: BigInt(0), data: receiptCalldata(hash) }));
}

async function update(receiptId: string, patch: Partial<AuditReceipt>) {
  await tx((db) => {
    const r = db.auditReceipts.find((x) => x.id === receiptId);
    if (r) Object.assign(r, patch);
  });
}

/** Hash a record, store a pending receipt, and (if a testnet key is set) commit the hash onchain. */
export async function commitReceipt(a: {
  userId: string;
  kind: AuditReceipt["kind"];
  ref?: string;
  record: Record<string, unknown>;
}): Promise<AuditReceipt> {
  const hash = sha256Hex(canonicalJson(a.record));
  const receipt: AuditReceipt = {
    id: id("rcpt_"), userId: a.userId, kind: a.kind, ...(a.ref ? { ref: a.ref } : {}),
    hash, chain: "bsc-testnet", status: "pending", createdAt: now(),
  };
  await tx((db) => { db.auditReceipts.push(receipt); });
  // Keep the canonical record offchain so the hash can be re-derived later (verifyReceipt).
  await audit({ userId: a.userId, actor: "system", action: RECORD_ACTION, ref: receipt.id, detail: { kind: a.kind, record: a.record } });

  if (!receiptsOnchainEnabled()) {
    await update(receipt.id, { status: "disabled" });
    return { ...receipt, status: "disabled" };
  }
  try {
    const txHash = await broadcast(hash);
    await update(receipt.id, { txHash, status: "committed" });
    await audit({ userId: a.userId, actor: "system", action: "receipt.committed", ref: receipt.id, detail: { txHash, hash } });
    return { ...receipt, txHash, status: "committed" };
  } catch (e) {
    const error = (e instanceof Error ? e.message : String(e)).split("\n")[0].slice(0, 300);
    await update(receipt.id, { status: "failed", error });
    await audit({ userId: a.userId, actor: "system", action: "receipt.failed", ref: receipt.id, detail: { error } });
    return { ...receipt, status: "failed", error };
  }
}

export function approvalRecord(p: TradeProposal, approvedAt: string) {
  return {
    type: "mayflower.approval",
    proposalId: p.id,
    version: p.version,
    userIdHash: userIdHash(p.userId),
    marketId: p.marketId,
    side: p.side,
    quantity: p.quantity,
    limitPrice: p.limitPrice,
    approvedAt,
  };
}

export async function policyRecord(userId: string) {
  const user = (await load()).users.find((u) => u.id === userId);
  if (!user) throw new Error("User not found");
  const L = user.limits;
  return {
    type: "mayflower.policy",
    userIdHash: userIdHash(userId),
    limits: {
      budgetUsd: L.budgetUsd,
      maxPerTradeUsd: L.maxPerTradeUsd,
      maxTotalExposureUsd: L.maxTotalExposureUsd,
      riskStyle: L.riskStyle,
      excludedTopics: [...L.excludedTopics].sort(),
    },
    permissions: "trade-only, no withdrawals",
    approvalRequired: "every order needs explicit per-trade user approval",
    paused: user.paused,
    committedAt: now(),
  };
}

export async function commitPolicy(userId: string) {
  return commitReceipt({ userId, kind: "policy", record: await policyRecord(userId) });
}

/**
 * Call after a proposal is approved. Fire-and-forget safe: never throws, idempotent per proposal.
 * Usage in execution: `void onApproved(p.id);`
 */
export async function onApproved(proposalId: string): Promise<AuditReceipt | undefined> {
  try {
    const db = await load();
    const p = db.proposals.find((x) => x.id === proposalId);
    if (!p || !["approved", "executed", "failed"].includes(p.status)) return undefined;
    if (db.auditReceipts.some((r) => r.kind === "approval" && r.ref === proposalId)) return undefined;
    const approvedAt = [...db.audit].reverse().find((e) => e.action === "approve" && e.ref === proposalId)?.createdAt ?? now();
    return await commitReceipt({ userId: p.userId, kind: "approval", ref: p.id, record: approvalRecord(p, approvedAt) });
  } catch (e) {
    console.error("[receipts] onApproved", e);
    return undefined;
  }
}

export async function listReceipts(userId: string): Promise<AuditReceipt[]> {
  return (await load())
    .auditReceipts.filter((r) => r.userId === userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Recompute the hash from the stored offchain record; if committed, also check the onchain calldata. */
export async function verifyReceipt(receiptId: string): Promise<{
  ok: boolean; hashMatches: boolean; onchainMatches?: boolean; hash?: string; recomputed?: string; error?: string;
}> {
  const db = await load();
  const r = db.auditReceipts.find((x) => x.id === receiptId);
  if (!r) return { ok: false, hashMatches: false, error: "Receipt not found." };
  const ev = db.audit.find((e) => e.action === RECORD_ACTION && e.ref === receiptId);
  const record = (ev?.detail as { record?: unknown } | undefined)?.record;
  if (!record) return { ok: false, hashMatches: false, hash: r.hash, error: "Offchain record not found." };
  const recomputed = sha256Hex(canonicalJson(record));
  const hashMatches = recomputed === r.hash;
  let onchainMatches: boolean | undefined;
  if (r.txHash) {
    try {
      const client = createPublicClient({ chain: bscTestnet, transport: http(RPC) });
      const t = await client.getTransaction({ hash: r.txHash as Hex });
      onchainMatches = t.input.toLowerCase() === receiptCalldata(r.hash).toLowerCase();
    } catch {
      onchainMatches = undefined; // RPC unavailable; offchain check still stands
    }
  }
  return { ok: hashMatches && onchainMatches !== false, hashMatches, onchainMatches, hash: r.hash, recomputed };
}
