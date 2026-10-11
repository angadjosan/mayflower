"use client";
import type { PortfolioView } from "./state";
import { Card, Sparkline, Stat, pnlClass, signedUsd, usd } from "./ui";

export function Performance({ p }: { p: PortfolioView }) {
  const maxTopic = Math.max(1, ...p.topicExposure.map((t) => t.usd));
  return (
    <Card title="Performance" action={<span className="text-xs text-stone-400">{p.mode === "sandbox" ? "Gemini sandbox" : p.mode === "live" ? "Live (real funds)" : p.mode === "testnet" ? "Hyperliquid testnet" : "Simulated"}</span>}>
      <Sparkline points={p.history.map((h) => h.valueUsd)} />
      <div className="mt-4 grid grid-cols-3 gap-3">
        <Stat label="Unrealized" value={signedUsd(p.unrealizedPnlUsd)} className={`text-base ${pnlClass(p.unrealizedPnlUsd)}`} />
        <Stat label="Realized" value={signedUsd(p.realizedPnlUsd)} className={`text-base ${pnlClass(p.realizedPnlUsd)}`} />
        <Stat
          label="Sharpe"
          value={p.sharpe == null ? <span className="text-sm font-normal text-stone-500">N/A (insufficient history)</span> : p.sharpe.toFixed(2)}
          className="text-base"
        />
      </div>
      <div className="mt-5">
        <div className="mb-2 text-xs font-semibold text-stone-500">Exposure by topic</div>
        {p.topicExposure.length === 0 ? (
          <p className="text-sm text-stone-400">No exposure yet.</p>
        ) : (
          <ul className="space-y-2">
            {p.topicExposure.map((t) => (
              <li key={t.topic} className="text-sm">
                <div className="flex justify-between">
                  <span>{t.topic}</span>
                  <span className="tabular-nums text-stone-500">{usd(t.usd, 0)}</span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-stone-100">
                  <div className="h-full rounded-full bg-money-400 transition-[width] duration-700" style={{ width: `${(t.usd / maxTopic) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}
        {p.exposureExplanation && <p className="mt-3 text-sm leading-relaxed text-stone-600">{p.exposureExplanation}</p>}
      </div>
    </Card>
  );
}
