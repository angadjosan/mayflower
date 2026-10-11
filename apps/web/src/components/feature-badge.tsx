import type { FeatureLabel } from "@mayflower/shared";
import { Badge } from "@/components/ui/primitives";

const TONES: Record<FeatureLabel, "positive" | "info" | "warning" | "negative" | "neutral"> = {
  live: "positive",
  sandbox: "info",
  simulated: "warning",
  demo: "warning",
  offline: "negative",
  not_implemented: "neutral",
};

const TEXT: Record<FeatureLabel, string> = {
  live: "Live",
  sandbox: "Sandbox",
  simulated: "Simulated",
  demo: "Demo data",
  offline: "Off",
  not_implemented: "Not yet implemented",
};

export function FeatureBadge({ label, children }: { label: FeatureLabel; children?: React.ReactNode }) {
  return <Badge tone={TONES[label]}>{children ?? TEXT[label]}</Badge>;
}

export function ModeBadge({ mode, simulated, env }: { mode: string | null; simulated?: boolean; env?: string }) {
  if (simulated || mode === "simulated") return <Badge tone="warning">Simulated</Badge>;
  if (mode === "shared_sandbox") return <Badge tone="info">Sandbox – shared account</Badge>;
  if (mode === "oauth") return <Badge tone={env === "production" ? "positive" : "info"}>{env === "production" ? "Gemini" : "Gemini sandbox"}</Badge>;
  return <Badge>Not linked</Badge>;
}
