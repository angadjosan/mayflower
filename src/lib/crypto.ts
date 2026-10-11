// AES-256-GCM encryption for connector tokens at rest.
// Key: MAYFLOWER_ENCRYPTION_KEY (32 bytes, base64 or hex). Dev fallback derives one from SESSION_SECRET.
import crypto from "crypto";

let cachedKey: Buffer | null = null;
let warned = false;

function key(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.MAYFLOWER_ENCRYPTION_KEY?.trim();
  if (raw) {
    let k: Buffer | null = null;
    if (/^[0-9a-fA-F]{64}$/.test(raw)) k = Buffer.from(raw, "hex");
    else {
      const b = Buffer.from(raw, "base64");
      if (b.length === 32) k = b;
    }
    if (!k) throw new Error("MAYFLOWER_ENCRYPTION_KEY must be 32 bytes, base64 or hex encoded");
    cachedKey = k;
    return k;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("MAYFLOWER_ENCRYPTION_KEY is required in production");
  }
  if (!warned) {
    warned = true;
    console.warn("[crypto] MAYFLOWER_ENCRYPTION_KEY not set; deriving a dev key from SESSION_SECRET. Do not use in production.");
  }
  cachedKey = crypto.createHash("sha256").update(process.env.SESSION_SECRET || "dev-insecure-session-secret").digest();
  return cachedKey;
}

/** Encrypts a JSON-serializable value. Output: `v1.<iv>.<tag>.<ciphertext>` (base64url parts). */
export function encryptJSON(obj: unknown): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(obj), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptJSON<T>(s: string): T {
  const [v, iv, tag, ct] = s.split(".");
  if (v !== "v1" || !iv || !tag || ct == null) throw new Error("Bad ciphertext format");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  const pt = Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]);
  return JSON.parse(pt.toString("utf8")) as T;
}
