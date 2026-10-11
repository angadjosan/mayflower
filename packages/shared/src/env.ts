/**
 * Centralised, typed environment access. Every integration reads from here so
 * missing configuration fails loudly at the edge rather than deep in a call.
 */
export type Mode = "live" | "sandbox" | "simulated";

function read(name: string, fallback?: string): string | undefined {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

export function requireEnv(name: string): string {
  const v = read(name);
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

export function optionalEnv(name: string, fallback?: string): string | undefined {
  return read(name, fallback);
}

/** Exchange execution mode. Defaults to "simulated" so a fresh checkout never hits a real venue. */
export function exchangeMode(): Mode {
  const m = read("MAYFLOWER_EXCHANGE_MODE", "simulated");
  if (m === "live" || m === "sandbox" || m === "simulated") return m;
  throw new Error(`Invalid MAYFLOWER_EXCHANGE_MODE=${m}`);
}
