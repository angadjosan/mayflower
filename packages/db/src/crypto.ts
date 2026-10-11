/**
 * AES-256-GCM for exchange credentials at rest. Key from MAYFLOWER_ENCRYPTION_KEY
 * (32 bytes, base64). Output: base64(iv | tag | ciphertext).
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { requireEnv } from "@mayflower/shared";

function key(): Buffer {
  const k = Buffer.from(requireEnv("MAYFLOWER_ENCRYPTION_KEY"), "base64");
  if (k.length !== 32) throw new Error("MAYFLOWER_ENCRYPTION_KEY must be 32 bytes base64");
  return k;
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}

export function decryptSecret(b64: string): string {
  const buf = Buffer.from(b64, "base64");
  const iv = buf.subarray(0, 12), tag = buf.subarray(12, 28), ct = buf.subarray(28);
  const d = createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
}
