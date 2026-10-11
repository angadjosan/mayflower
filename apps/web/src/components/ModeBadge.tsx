export function ModeBadge({ mode }: { mode: string }) {
  const label = mode === "simulated" ? "SIMULATED" : mode === "sandbox" ? "SANDBOX" : mode === "live" ? "LIVE" : mode.toUpperCase();
  return <span className="badge">{label}</span>;
}
