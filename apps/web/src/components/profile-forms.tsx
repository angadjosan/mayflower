"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Badge, Button, Input, Label } from "@/components/ui/primitives";

interface ProfileValues {
  displayName: string;
  riskBudget: number;
  maxPerPosition: number;
  maxTotalExposure: number;
  riskStyle: "conservative" | "balanced" | "aggressive";
  interests: string[];
  excludedTopics: string[];
  notifyLevel: "important" | "all" | "none";
}

function TagEditor({ label, values, onChange, placeholder }: { label: string; values: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const [draft, setDraft] = useState("");
  return (
    <div>
      <Label>{label}</Label>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {values.map((v) => (
          <Badge key={v} tone="info" className="py-1">
            {v}
            <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))}>
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
        {values.length === 0 ? <span className="text-xs text-muted">None</span> : null}
      </div>
      <div className="mt-2 flex gap-2">
        <Input
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (draft.trim()) onChange([...values, draft.trim()]);
              setDraft("");
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            if (draft.trim()) onChange([...values, draft.trim()]);
            setDraft("");
          }}
        >
          Add
        </Button>
      </div>
    </div>
  );
}

export function ProfileForm({ initial }: { initial: ProfileValues }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof ProfileValues>(k: K, val: ProfileValues[K]) => setV((s) => ({ ...s, [k]: val }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch("/api/profile", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(v) });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    setMsg({ ok: res.ok, text: res.ok ? "Saved." : (data.error ?? "Couldn't save.") });
    router.refresh();
  }

  return (
    <form onSubmit={save} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor="budget">Risk budget ($)</Label>
          <Input id="budget" type="number" min={1} step="0.01" value={v.riskBudget} onChange={(e) => set("riskBudget", Number(e.target.value))} />
          <p className="mt-1 text-xs text-muted">A limit, not a deposit.</p>
        </div>
        <div>
          <Label htmlFor="per">Max loss per position ($)</Label>
          <Input id="per" type="number" min={0.01} step="0.01" value={v.maxPerPosition} onChange={(e) => set("maxPerPosition", Number(e.target.value))} />
        </div>
        <div>
          <Label htmlFor="total">Max total at risk ($)</Label>
          <Input id="total" type="number" min={0.01} step="0.01" value={v.maxTotalExposure} onChange={(e) => set("maxTotalExposure", Number(e.target.value))} />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor="style">Sizing style</Label>
          <select id="style" className="mt-1 h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm" value={v.riskStyle} onChange={(e) => set("riskStyle", e.target.value as ProfileValues["riskStyle"])}>
            <option value="conservative">Conservative (¼ Kelly)</option>
            <option value="balanced">Balanced</option>
            <option value="aggressive">Aggressive (½ Kelly)</option>
          </select>
        </div>
        <div>
          <Label htmlFor="notify">Notifications</Label>
          <select id="notify" className="mt-1 h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm" value={v.notifyLevel} onChange={(e) => set("notifyLevel", e.target.value as ProfileValues["notifyLevel"])}>
            <option value="important">Important changes only</option>
            <option value="all">Everything</option>
            <option value="none">None (dashboard only)</option>
          </select>
        </div>
        <div>
          <Label htmlFor="name">Name</Label>
          <Input id="name" value={v.displayName} onChange={(e) => set("displayName", e.target.value)} placeholder="Optional" />
        </div>
      </div>
      <TagEditor label="Interests" values={v.interests} onChange={(x) => set("interests", x)} placeholder="e.g. Seahawks, AI infrastructure" />
      <TagEditor label="Topics to skip" values={v.excludedTopics} onChange={(x) => set("excludedTopics", x)} placeholder="e.g. politics" />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save profile"}
        </Button>
        {msg ? <span className={`text-sm ${msg.ok ? "text-positive" : "text-negative"}`}>{msg.text}</span> : null}
      </div>
    </form>
  );
}

export function AddBelief() {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [belief, setBelief] = useState("");
  const [stance, setStance] = useState<"bullish" | "bearish" | "neutral">("bullish");
  const [confidence, setConfidence] = useState(0.6);
  return (
    <form
      className="grid gap-2 sm:grid-cols-[1fr_2fr_auto_auto_auto]"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!topic || !belief) return;
        await fetch("/api/theses", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ topic, belief, stance, confidence }) });
        setTopic("");
        setBelief("");
        router.refresh();
      }}
    >
      <Input placeholder="Topic" value={topic} onChange={(e) => setTopic(e.target.value)} />
      <Input placeholder="What you believe" value={belief} onChange={(e) => setBelief(e.target.value)} />
      <select className="h-10 rounded-lg border border-border bg-surface px-2 text-sm" value={stance} onChange={(e) => setStance(e.target.value as typeof stance)}>
        <option value="bullish">Will happen / rise</option>
        <option value="bearish">Won't happen / fall</option>
        <option value="neutral">Neutral</option>
      </select>
      <select className="h-10 rounded-lg border border-border bg-surface px-2 text-sm" value={confidence} onChange={(e) => setConfidence(Number(e.target.value))}>
        <option value={0.4}>Unsure</option>
        <option value={0.6}>Fairly sure</option>
        <option value={0.8}>Very sure</option>
      </select>
      <Button type="submit" variant="outline">
        Add
      </Button>
    </form>
  );
}

export function RemoveBelief({ id }: { id: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className="text-xs text-muted hover:text-negative"
      onClick={async () => {
        await fetch(`/api/theses/${id}`, { method: "DELETE" });
        router.refresh();
      }}
    >
      Remove
    </button>
  );
}
