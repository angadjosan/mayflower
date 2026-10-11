"use client";
import { useEffect, useState } from "react";
import type { DashState } from "./state";
import { Sparkline, signedPct } from "./ui";

type Ticker = { symbol: string; price: number; change24h: number | null; spark: number[] };

const price = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: n < 10 ? 4 : 2 });

/** Up to four prediction markets the user owns or is being pitched, with their YES price. */
function marketTickers(s: DashState) {
  const seen = new Set<string>();
  const out: { id: string; title: string; yes: number; held: boolean }[] = [];
  const yesOf = (side: "YES" | "NO", p: number) => (side === "YES" ? p : 1 - p);
  for (const p of s.positions.filter((x) => x.status === "open")) {
    if (seen.has(p.marketId)) continue;
    seen.add(p.marketId);
    out.push({ id: p.marketId, title: p.market.title, yes: yesOf(p.side, p.currentPrice ?? p.avgEntryPrice), held: true });
  }
  for (const p of s.proposals.filter((x) => x.status === "pending")) {
    if (seen.has(p.marketId)) continue;
    seen.add(p.marketId);
    out.push({ id: p.marketId, title: p.market.title, yes: yesOf(p.side, p.limitPrice), held: false });
  }
  return out.slice(0, 4);
}

export function TickerStrip({ s }: { s: DashState }) {
  const [tickers, setTickers] = useState<Ticker[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/tickers");
        if (!r.ok) return;
        const j = (await r.json()) as { tickers: Ticker[] };
        if (alive) setTickers(j.tickers);
      } catch { /* offline: keep last */ }
    };
    void load();
    const t = setInterval(load, 15_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const markets = marketTickers(s);

  return (
    <div className="border-b border-line bg-raised">
      <div className="fade-x no-scrollbar mx-auto flex max-w-6xl items-center gap-6 overflow-x-auto px-4 py-2.5 sm:px-6">
        {tickers === null
          ? ["BTC", "ETH", "SOL"].map((sym) => (
              <div key={sym} className="flex shrink-0 items-center gap-2 text-[13px]">
                <span className="font-medium text-fg">{sym}</span>
                <span className="h-3 w-16 animate-pulse rounded bg-sunken" />
              </div>
            ))
          : tickers.map((t) => (
              <div key={t.symbol} className="flex shrink-0 items-center gap-2 text-[13px]">
                <span className="font-semibold text-fg">{t.symbol}</span>
                <span className="num text-fg-2">{price(t.price)}</span>
                <span className={`num text-xs ${t.change24h == null ? "text-muted" : t.change24h >= 0 ? "text-up" : "text-down"}`}>
                  {signedPct(t.change24h)}
                </span>
                <Sparkline points={t.spark} />
              </div>
            ))}
        {markets.length > 0 && <span className="h-4 w-px shrink-0 bg-line-strong" aria-hidden />}
        {markets.map((m) => (
          <div key={m.id} className="flex max-w-[260px] shrink-0 items-center gap-2 text-[13px]" title={m.title}>
            {m.held && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-label="You hold this" />}
            <span className="truncate text-fg-2">{m.title}</span>
            <span className="num shrink-0 font-medium text-fg">{Math.round(m.yes * 100)}¢</span>
            <span className="shrink-0 text-[11px] text-subtle">YES</span>
          </div>
        ))}
      </div>
    </div>
  );
}
