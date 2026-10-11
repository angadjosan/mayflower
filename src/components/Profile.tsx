"use client";
import { useEffect, useState } from "react";
import type { RiskLimits, User, UserThesis } from "@/lib/types";
import { Badge, Button, Card } from "./ui";

export function Profile({
  user, theses, onSave, onLinkGemini, busy,
}: {
  user: User;
  theses: UserThesis[];
  onSave: (body: { limits: Partial<RiskLimits>; name?: string; handle?: string }) => Promise<void>;
  onLinkGemini: () => void;
  busy: boolean;
}) {
  const [form, setForm] = useState(() => toForm(user));
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!dirty) setForm(toForm(user));
  }, [user, dirty]);

  const set = (k: keyof ReturnType<typeof toForm>, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setDirty(true);
    setSaved(false);
  };

  const save = async () => {
    await onSave({
      name: form.name || undefined,
      handle: form.handle || undefined,
      limits: {
        budgetUsd: Number(form.budget) || 0,
        maxPerTradeUsd: Number(form.maxPerTrade) || 0,
        maxTotalExposureUsd: Number(form.maxTotal) || 0,
        riskStyle: form.riskStyle as RiskLimits["riskStyle"],
        excludedTopics: form.excluded.split(",").map((s) => s.trim()).filter(Boolean),
      },
    });
    setDirty(false);
    setSaved(true);
  };

  const input = "w-full rounded-xl bg-stone-100 px-3 py-2 text-sm outline-none ring-money-400 transition focus:bg-white focus:ring-2";
  return (
    <Card title="You & your limits">
      <div className="mb-4">
        <div className="mb-2 text-xs font-semibold text-stone-500">What Mayflower knows you care about</div>
        {theses.length === 0 ? (
          <p className="text-sm text-stone-400">Nothing yet. Tell Mayflower your interests in chat or iMessage.</p>
        ) : (
          <ul className="flex flex-col items-start gap-1">
            {theses.map((t) => (
              <li key={t.id} className="max-w-full rounded-[18px] rounded-bl-[6px] bg-bubble px-3 py-1.5 text-sm">
                <span className="font-semibold">{t.topic}</span>
                <span className="text-stone-700">: {t.belief}</span>{" "}
                <span className="text-xs text-stone-500">({Math.round(t.confidence * 100)}% sure, via {t.source})</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Name"><input className={input} value={form.name} onChange={(e) => set("name", e.target.value)} /></Field>
        <Field label="iMessage handle"><input className={input} value={form.handle} placeholder="+1 555… or Apple ID" onChange={(e) => set("handle", e.target.value)} /></Field>
        <Field label="Total budget ($)"><input className={input} type="number" min={0} value={form.budget} onChange={(e) => set("budget", e.target.value)} /></Field>
        <Field label="Max per trade ($)"><input className={input} type="number" min={0} value={form.maxPerTrade} onChange={(e) => set("maxPerTrade", e.target.value)} /></Field>
        <Field label="Max total exposure ($)"><input className={input} type="number" min={0} value={form.maxTotal} onChange={(e) => set("maxTotal", e.target.value)} /></Field>
        <Field label="Risk style">
          <select className={input} value={form.riskStyle} onChange={(e) => set("riskStyle", e.target.value)}>
            <option value="conservative">Conservative</option>
            <option value="balanced">Balanced</option>
            <option value="aggressive">Aggressive</option>
          </select>
        </Field>
        <div className="col-span-2">
          <Field label="Excluded topics (comma separated)"><input className={input} value={form.excluded} onChange={(e) => set("excluded", e.target.value)} /></Field>
        </div>
      </div>
      <p className="mt-2 text-xs text-stone-400">Your budget is a limit, not a deposit. Funds stay in your own Gemini account.</p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={save} disabled={busy || !dirty}>Save</Button>
        {saved && <span className="animate-pop text-xs font-semibold text-money-600">✓ Saved</span>}
        <div className="ml-auto">
          {user.geminiLinked ? (
            <Badge tone="accent">Gemini linked (sandbox, shared account)</Badge>
          ) : (
            <Button onClick={onLinkGemini} disabled={busy}>Connect Gemini</Button>
          )}
        </div>
      </div>
    </Card>
  );
}

function toForm(u: User) {
  return {
    name: u.name ?? "",
    handle: u.handle ?? "",
    budget: String(u.limits.budgetUsd),
    maxPerTrade: String(u.limits.maxPerTradeUsd),
    maxTotal: String(u.limits.maxTotalExposureUsd),
    riskStyle: u.limits.riskStyle as string,
    excluded: u.limits.excludedTopics.join(", "),
  };
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-stone-500">{label}</span>
      {children}
    </label>
  );
}
