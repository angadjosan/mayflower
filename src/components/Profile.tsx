"use client";
import { useEffect, useState } from "react";
import type { RiskLimits, User, UserThesis } from "@/lib/types";
import { Icon } from "./icons";
import { Button, Chip, Eyebrow, IconButton, Ring, Segmented, Sheet, usd } from "./ui";

type Form = {
  name: string; handle: string; budget: number; maxPerTrade: number; maxTotal: number;
  riskStyle: RiskLimits["riskStyle"]; excluded: string[];
};
const toForm = (u: User): Form => ({
  name: u.name ?? "",
  handle: u.handle ?? "",
  budget: u.limits.budgetUsd,
  maxPerTrade: u.limits.maxPerTradeUsd,
  maxTotal: u.limits.maxTotalExposureUsd,
  riskStyle: u.limits.riskStyle,
  excluded: u.limits.excludedTopics,
});

const budgetStep = (v: number) => (v < 1000 ? 50 : v < 10_000 ? 250 : 1000);
const PRESETS = [100, 500, 1000, 5000];

function Tile({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-line bg-surface p-4 shadow-card ${className}`}>{children}</div>;
}

function Slider({ label, value, max, onChange, icon }: { label: string; value: number; max: number; onChange: (v: number) => void; icon: "target" | "layers" }) {
  const m = Math.max(1, max);
  const step = m <= 200 ? 1 : m <= 2000 ? 5 : 50;
  const v = Math.min(value, m);
  return (
    <div>
      <div className="flex items-center justify-between">
        <Eyebrow className="flex items-center gap-1.5"><Icon name={icon} className="h-3.5 w-3.5" />{label}</Eyebrow>
        <span className="num text-sm font-semibold text-fg">{usd(v, 0)}</span>
      </div>
      <input
        type="range"
        min={0}
        max={m}
        step={step}
        value={v}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        className="mt-3 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-sunken accent-[var(--accent)]"
        style={{ background: `linear-gradient(to right, var(--accent) ${(v / m) * 100}%, var(--sunken) ${(v / m) * 100}%)` }}
      />
      <div className="num mt-1 flex justify-between text-[10px] text-subtle"><span>$0</span><span>{Math.round((v / m) * 100)}% of budget</span></div>
    </div>
  );
}

export function Profile({
  user, theses, onSave, onLinkGemini, busy,
}: {
  user: User;
  theses: UserThesis[];
  onSave: (body: { limits: Partial<RiskLimits>; name?: string; handle?: string }) => Promise<void>;
  onLinkGemini: () => void;
  busy: boolean;
}) {
  const [form, setForm] = useState<Form>(() => toForm(user));
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editId, setEditId] = useState(false);
  const [thesis, setThesis] = useState<UserThesis | null>(null);
  const [topic, setTopic] = useState("");

  useEffect(() => {
    if (!dirty) setForm(toForm(user));
  }, [user, dirty]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setDirty(true);
    setSaved(false);
  };

  const save = async () => {
    await onSave({
      name: form.name || undefined,
      handle: form.handle || undefined,
      limits: {
        budgetUsd: form.budget,
        maxPerTradeUsd: Math.min(form.maxPerTrade, form.budget),
        maxTotalExposureUsd: Math.min(form.maxTotal, form.budget),
        riskStyle: form.riskStyle,
        excludedTopics: form.excluded,
      },
    });
    setDirty(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const addTopic = () => {
    const t = topic.trim();
    if (t && !form.excluded.some((x) => x.toLowerCase() === t.toLowerCase())) set("excluded", [...form.excluded, t]);
    setTopic("");
  };

  const input = "h-11 w-full rounded-xl border border-line-strong bg-surface px-3 text-sm text-fg outline-none transition placeholder:text-subtle focus:border-accent";

  return (
    <div className="space-y-3">
      {/* Identity */}
      <Tile className="flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-sunken text-base font-semibold uppercase text-fg-2">
          {(form.name || "?").slice(0, 1)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-fg">{form.name || "No name"}</div>
          <div className="truncate text-xs text-muted">{form.handle || "No handle"}</div>
        </div>
        {user.geminiLinked ? (
          <Chip tone="up" title="Gemini linked"><Icon name="check" className="h-3 w-3" />Gemini</Chip>
        ) : (
          <Button size="sm" variant="outline" onClick={onLinkGemini} disabled={busy}><Icon name="link" className="h-3.5 w-3.5" />Gemini</Button>
        )}
        <IconButton label="Edit name and handle" onClick={() => setEditId(true)}><Icon name="pencil" /></IconButton>
      </Tile>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* Limits */}
        <Tile className="space-y-5">
          <div>
            <Eyebrow className="flex items-center gap-1.5"><Icon name="wallet" className="h-3.5 w-3.5" />Budget</Eyebrow>
            <div className="mt-2 flex items-center gap-3">
              <IconButton label="Decrease budget" className="border border-line-strong" onClick={() => set("budget", Math.max(0, form.budget - budgetStep(form.budget - 1)))}><Icon name="minus" /></IconButton>
              <div className="num flex-1 text-center text-3xl font-semibold tracking-tight text-fg">{usd(form.budget, 0)}</div>
              <IconButton label="Increase budget" className="border border-line-strong" onClick={() => set("budget", Math.min(100_000, form.budget + budgetStep(form.budget)))}><Icon name="plus" /></IconButton>
            </div>
            <div className="mt-3 flex justify-center gap-1.5">
              {PRESETS.map((v) => (
                <button key={v} onClick={() => set("budget", v)} className={`num h-7 rounded-full px-2.5 text-xs transition-colors ${form.budget === v ? "bg-ink text-ink-fg" : "bg-sunken text-fg-2 hover:text-fg"}`}>
                  {v >= 1000 ? `$${v / 1000}k` : `$${v}`}
                </button>
              ))}
            </div>
          </div>
          <Slider label="Per trade" icon="target" value={form.maxPerTrade} max={form.budget} onChange={(v) => set("maxPerTrade", v)} />
          <Slider label="Total at risk" icon="layers" value={form.maxTotal} max={form.budget} onChange={(v) => set("maxTotal", v)} />
          <div className="flex items-center justify-between gap-3">
            <Eyebrow>Style</Eyebrow>
            <Segmented<RiskLimits["riskStyle"]>
              label="Risk style"
              value={form.riskStyle}
              onChange={(v) => set("riskStyle", v)}
              options={[
                { value: "conservative", label: "Low", title: "Conservative" },
                { value: "balanced", label: "Mid", title: "Balanced" },
                { value: "aggressive", label: "High", title: "Aggressive" },
              ]}
            />
          </div>
        </Tile>

        <div className="space-y-3">
          {/* Beliefs */}
          <Tile>
            <Eyebrow className="flex items-center gap-1.5"><Icon name="sparkle" className="h-3.5 w-3.5" />Beliefs</Eyebrow>
            {theses.length === 0 ? (
              <div className="mt-3 text-sm text-subtle">None yet</div>
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                {theses.map((t) => (
                  <button key={t.id} onClick={() => setThesis(t)} className="flex items-center gap-2 rounded-full border border-line py-1 pl-1 pr-3 text-xs text-fg transition-colors hover:bg-sunken" title={t.belief}>
                    <Ring value={t.confidence} size={22} stroke={2.5} color="var(--accent)" label={`${Math.round(t.confidence * 100)}% confident`} />
                    {t.topic}
                  </button>
                ))}
              </div>
            )}
          </Tile>

          {/* Excluded topics */}
          <Tile>
            <Eyebrow className="flex items-center gap-1.5"><Icon name="x" className="h-3.5 w-3.5" />Excluded</Eyebrow>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {form.excluded.map((t) => (
                <span key={t} className="inline-flex h-7 items-center gap-1 rounded-full bg-sunken pl-3 pr-1 text-xs text-fg-2">
                  {t}
                  <button onClick={() => set("excluded", form.excluded.filter((x) => x !== t))} aria-label={`Remove ${t}`} className="flex h-5 w-5 items-center justify-center rounded-full text-muted hover:bg-line hover:text-fg">
                    <Icon name="x" className="h-3 w-3" />
                  </button>
                </span>
              ))}
              <form onSubmit={(e) => { e.preventDefault(); addTopic(); }} className="relative">
                <input
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="Add"
                  aria-label="Exclude a topic"
                  className="h-7 w-24 rounded-full border border-dashed border-line-strong bg-transparent pl-3 pr-7 text-xs text-fg outline-none placeholder:text-subtle focus:border-accent"
                />
                <button type="submit" aria-label="Add topic" className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full text-muted hover:text-fg">
                  <Icon name="plus" className="h-3 w-3" />
                </button>
              </form>
            </div>
          </Tile>
        </div>
      </div>

      {(dirty || saved) && (
        <div className="animate-rise sticky bottom-4 z-20 flex justify-end">
          <Button variant="primary" onClick={save} disabled={busy || !dirty} className="shadow-[0_12px_32px_-12px_rgba(0,0,0,0.5)]">
            {saved ? <><Icon name="check" className="h-4 w-4" />Saved</> : "Save changes"}
          </Button>
        </div>
      )}

      <Sheet open={editId} onClose={() => setEditId(false)} title="Profile">
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1.5 block text-xs text-muted">Name</span>
            <input className={input} value={form.name} onChange={(e) => set("name", e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs text-muted">iMessage handle</span>
            <input className={input} value={form.handle} placeholder="+1 555… or Apple ID" onChange={(e) => set("handle", e.target.value)} />
          </label>
          <Button variant="primary" className="w-full" onClick={() => setEditId(false)}>Done</Button>
        </div>
      </Sheet>

      <Sheet open={!!thesis} onClose={() => setThesis(null)} title={thesis?.topic}>
        {thesis && (
          <div className="space-y-4">
            <p className="text-sm leading-relaxed text-fg">{thesis.belief || "—"}</p>
            <div className="flex gap-1.5">
              <Chip tone="accent">{Math.round(thesis.confidence * 100)}% sure</Chip>
              <Chip>{thesis.source}</Chip>
            </div>
          </div>
        )}
      </Sheet>
    </div>
  );
}
