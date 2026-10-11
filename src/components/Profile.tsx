"use client";
import { useEffect, useState } from "react";
import type { RiskLimits, User, UserThesis } from "@/lib/types";
import { Button } from "./ui";

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

  const input = "h-10 w-full rounded-xl border border-line-strong bg-surface px-3 text-sm text-fg outline-none transition placeholder:text-subtle focus:border-accent";
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div>
        <h3 className="text-[15px] font-semibold tracking-tight text-fg">What Mayflower knows about you</h3>
        <p className="mt-1 text-[13px] text-muted">Beliefs picked up from your texts and connected apps. Used to find ideas, never as permission to trade.</p>
        {theses.length === 0 ? (
          <p className="mt-4 text-sm text-subtle">Nothing yet. Text Mayflower what you follow and what you believe.</p>
        ) : (
          <ul className="mt-4 divide-y divide-line border-y border-line">
            {theses.map((t) => (
              <li key={t.id} className="flex items-start gap-3 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-fg">{t.topic}</div>
                  {t.belief && <div className="mt-0.5 text-[13px] leading-snug text-fg-2">{t.belief}</div>}
                </div>
                <div className="num shrink-0 text-right text-xs text-muted">
                  {Math.round(t.confidence * 100)}%
                  <div className="text-[11px] text-subtle">{t.source}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
      <h3 className="mb-4 text-[15px] font-semibold tracking-tight text-fg">Limits</h3>
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
      <p className="mt-3 text-xs text-subtle">Your budget is a limit, not a deposit. Funds stay in your own exchange accounts.</p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={save} disabled={busy || !dirty}>Save</Button>
        {saved && <span className="animate-fade text-xs text-muted">Saved</span>}
        <div className="ml-auto">
          {user.geminiLinked ? (
            <span className="text-xs text-muted">Gemini linked</span>
          ) : (
            <Button onClick={onLinkGemini} disabled={busy}>Connect Gemini</Button>
          )}
        </div>
      </div>
      </div>
    </div>
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
      <span className="mb-1.5 block text-xs text-muted">{label}</span>
      {children}
    </label>
  );
}
