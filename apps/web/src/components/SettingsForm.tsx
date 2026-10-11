"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { RiskLimits } from "@mayflower/shared";

export function SettingsForm({ limits, theses, connection, exchangeMode, oauthAvailable }: { limits: RiskLimits | null; theses: Array<{ topic: string; belief: string; isInterest: boolean }>; connection: { kind: string; roles: string[]; linkedAt: string } | null; exchangeMode: string; oauthAvailable: boolean }) {
  const router = useRouter();
  const [f, setF] = useState({ totalBudget: limits?.totalBudget ?? 0, maxPerPosition: limits?.maxPerPosition ?? 0, maxThemeConcentration: limits?.maxThemeConcentration ?? 0.4, kellyFraction: limits?.kellyFraction ?? 0.25, minEdge: limits?.minEdge ?? 0.05, excludedTopics: (limits?.excludedTopics ?? []).join(", "), paused: limits?.paused ?? false });
  const [key, setKey] = useState({ apiKey: "", apiSecret: "" });
  const [note, setNote] = useState<string | null>(null);
  const save = async () => {
    const r = await fetch("/api/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...f, excludedTopics: f.excludedTopics.split(",").map((s) => s.trim()).filter(Boolean) }) });
    setNote(r.ok ? "Saved." : (await r.json()).error); router.refresh();
  };
  const link = async () => {
    const r = await fetch("/api/exchange/link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(key) });
    setNote(r.ok ? "Gemini account linked (Trader role only)." : (await r.json()).error); setKey({ apiKey: "", apiSecret: "" }); router.refresh();
  };
  return (
    <div className="space-y-4">
      <div className="card space-y-2 text-sm">
        <h2 className="font-semibold">Risk limits (enforced by the risk engine, not the AI)</h2>
        <div className="grid sm:grid-cols-2 gap-2">
          <L k="Total budget you can lose ($)"><input type="number" value={f.totalBudget} onChange={(e) => setF({ ...f, totalBudget: +e.target.value })} /></L>
          <L k="Max per position ($)"><input type="number" value={f.maxPerPosition} onChange={(e) => setF({ ...f, maxPerPosition: +e.target.value })} /></L>
          <L k="Max share of budget in one theme"><input type="number" step="0.05" value={f.maxThemeConcentration} onChange={(e) => setF({ ...f, maxThemeConcentration: +e.target.value })} /></L>
          <L k="Kelly fraction"><input type="number" step="0.05" value={f.kellyFraction} onChange={(e) => setF({ ...f, kellyFraction: +e.target.value })} /></L>
          <L k="Minimum edge"><input type="number" step="0.01" value={f.minEdge} onChange={(e) => setF({ ...f, minEdge: +e.target.value })} /></L>
          <L k="Excluded topics (comma-separated)"><input value={f.excludedTopics} onChange={(e) => setF({ ...f, excludedTopics: e.target.value })} /></L>
        </div>
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.paused} onChange={(e) => setF({ ...f, paused: e.target.checked })} /> Pause Mayflower (kill switch — no proposals, no orders)</label>
        <button className="btn btn-primary" onClick={save}>Save</button>
      </div>
      <div className="card text-sm space-y-1">
        <h2 className="font-semibold">What Mayflower knows about you</h2>
        {theses.length ? <ul className="list-disc pl-4">{theses.map((t, i) => <li key={i}><b>{t.topic}</b>: {t.belief}{t.isInterest ? " (interest)" : ""}</li>)}</ul> : <p className="text-muted">Nothing yet — tell Mayflower in chat. You can update these naturally (“I&apos;m less confident about that now”).</p>}
      </div>
      <div className="card text-sm space-y-2">
        <h2 className="font-semibold">Gemini account <span className="badge">{exchangeMode}</span></h2>
        <p className="text-muted">Mayflower never holds funds. You fund your own Gemini account; Mayflower gets the Trader role only (no withdrawals or transfers).</p>
        {connection ? <p>Linked via {connection.kind} · roles {connection.roles.join(", ")} · {new Date(connection.linkedAt).toLocaleDateString()}</p> : <p>Not linked{exchangeMode === "sandbox" ? " — using the shared sandbox account if configured" : ""}.</p>}
        {exchangeMode === "simulated" && <p className="text-muted">Exchange mode is simulated; set MAYFLOWER_EXCHANGE_MODE=sandbox to trade on Gemini sandbox.</p>}
        {oauthAvailable ? <a className="btn btn-primary inline-block" href="/api/exchange/oauth/start">Connect Gemini (OAuth)</a> : <p className="text-xs text-muted">OAuth client not configured — API-key fallback below.</p>}
        <div className="grid sm:grid-cols-2 gap-2">
          <L k="Gemini API key (Trader role)"><input value={key.apiKey} onChange={(e) => setKey({ ...key, apiKey: e.target.value })} /></L>
          <L k="API secret"><input type="password" value={key.apiSecret} onChange={(e) => setKey({ ...key, apiSecret: e.target.value })} /></L>
        </div>
        <button className="btn" onClick={link} disabled={!key.apiKey || !key.apiSecret}>Link with API key</button>
      </div>
      {note && <div className="text-sm">{note}</div>}
      <style>{`.card input{width:100%;border:1px solid var(--border);border-radius:8px;padding:6px 8px;background:var(--background)}`}</style>
    </div>
  );
}
function L({ k, children }: { k: string; children: React.ReactNode }) { return <label className="block"><span className="text-xs text-muted">{k}</span>{children}</label>; }
