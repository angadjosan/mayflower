"use client";
import { useEffect, useState } from "react";
import type { DashState } from "./state";
import LogoLoop, { type LogoItem } from "./reactbits/LogoLoop";
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

  const coins = tickers ?? ["BTC", "ETH", "SOL"].map((symbol) => ({ symbol, price: NaN, change24h: null, spark: [] }));
  const items: LogoItem[] = [
    ...coins.map((t) => ({
      title: t.symbol,
      node: (
        <span className="flex items-center gap-2 text-[13px] leading-none">
          <span className="font-semibold text-fg">{t.symbol}</span>
          {Number.isFinite(t.price) ? (
            <>
              <span className="num text-fg-2">{price(t.price)}</span>
              <span className={`num text-xs ${t.change24h == null ? "text-muted" : t.change24h >= 0 ? "text-up" : "text-down"}`}>{signedPct(t.change24h)}</span>
              <Sparkline points={t.spark} />
            </>
          ) : (
            <span className="h-3 w-16 animate-pulse rounded bg-sunken" />
          )}
        </span>
      ),
    })),
    ...markets.map((m) => ({
      title: m.title,
      node: (
        <span className="flex max-w-[280px] items-center gap-2 text-[13px] leading-none">
          {m.held && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-label="You hold this" />}
          <span className="truncate text-fg-2">{m.title}</span>
          <span className="num shrink-0 font-medium text-fg">{Math.round(m.yes * 100)}¢</span>
          <span className="shrink-0 text-[11px] text-subtle">YES</span>
        </span>
      ),
    })),
  ];

  return (
    <div className="border-b border-line bg-raised/80 backdrop-blur">
      <div className="h-10 overflow-hidden">
        <LogoLoop
          logos={items}
          speed={36}
          gap={36}
          logoHeight={18}
          pauseOnHover
          fadeOut
          fadeOutColor="var(--raised)"
          ariaLabel="Live prices"
          className="h-10 [&_ul]:h-10 [&_ul]:items-center"
        />
      </div>
    </div>
  );
}
