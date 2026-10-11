import Link from "next/link";
import crypto from "crypto";
import { load } from "@/lib/db";
import { orderModeFor, venueLabel, venueOf } from "@/lib/exchange";
import ApproveActions from "./ApproveActions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function tokenOk(expected: string, given?: string) {
  if (!given) return false;
  const a = Buffer.from(expected), b = Buffer.from(given);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const usd = (n: number) => `$${n.toFixed(2)}`;
const pct = (n: number) => `${Math.round(n * 100)}%`;

export default async function ApprovePage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const { id } = await params;
  const { t } = await searchParams;
  const db = await load();
  const p = db.proposals.find((x) => x.id === id);

  if (!p || !tokenOk(p.approvalToken, t)) {
    return (
      <main className="min-h-screen bg-bg px-4 pt-24 text-center">
        <div className="mx-auto max-w-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-512.png" alt="" className="mx-auto h-10 w-10 rounded-[22%]" />
          <h1 className="mt-5 text-xl font-semibold tracking-tight text-fg">Link not valid</h1>
          <p className="mt-2 text-sm text-muted">This approval link is invalid or incomplete. Ask Mayflower for a fresh proposal.</p>
        </div>
      </main>
    );
  }

  const order = db.orders.find((o) => o.proposalId === p.id);
  const research = db.research.find((r) => r.id === p.researchId);
  const expired = new Date(p.expiresAt).getTime() < Date.now();
  const mode = orderModeFor(p.market);
  const simulated = mode === "simulated";
  const venue = venueOf(p.market);
  const buying = p.kind === "open" || p.kind === "hedge";
  const action = buying ? "Buy" : "Sell";
  const maxLoss = buying ? p.costUsd : 0;

  const rows: [string, string][] = [
    ["Event", p.market.eventTitle],
    ["Contract", p.market.title],
    ["Order", `${action} ${p.quantity} ${p.side} contracts`],
    ["Limit price", `${usd(p.limitPrice)} per contract`],
    ["Total cost", usd(p.costUsd)],
    ["Max loss", buying ? usd(maxLoss) : "n/a (closing)"],
    ["Market probability", pct(p.marketProbability)],
    [`Mayflower estimate (${p.side} wins)`, pct(p.estimatedProbability)],
    ["Edge", `${(p.edge * 100).toFixed(1)} pts`],
    ["Market closes", p.market.expiresAt ? new Date(p.market.expiresAt).toLocaleString() : "unknown"],
    ["Proposal expires", new Date(p.expiresAt).toLocaleString()],
  ];

  const venueName = venue === "polymarket" ? "Polymarket" : venue === "hyperliquid" ? "Hyperliquid" : "Gemini";
  const edgePts = Math.round(p.edge * 100);
  const [whole, frac] = usd(p.costUsd).split(".");

  return (
    <main className="min-h-screen bg-bg">
      <div className="mx-auto max-w-lg px-4 pb-10 sm:px-6">
        <header className="flex h-16 items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-512.png" alt="" className="h-7 w-7 rounded-[22%]" />
            <span className="text-[17px] font-semibold tracking-tight text-fg">Mayflower</span>
          </Link>
          <span
            className="inline-flex items-center gap-1 rounded-full border border-warn/30 bg-warn-soft px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-[0.06em] text-warn"
            title={simulated ? "Simulated order" : venueLabel(mode, venue)}
          >
            <span className="h-1 w-1 rounded-full bg-warn" aria-hidden />
            {simulated ? "Simulated" : "Testnet"}
          </span>
        </header>

        <section className="animate-rise pt-6">
          <div className="flex items-center gap-2 text-[13px] text-muted">
            <span className="inline-flex items-center gap-1.5 rounded-md border border-line px-1.5 py-0.5 text-[11px] font-medium text-fg-2">{venueName}</span>
            <span>Review order</span>
          </div>
          <h1 className="mt-3 text-xl font-semibold leading-snug tracking-tight text-fg">{p.market.title}</h1>
          {p.market.eventTitle && p.market.eventTitle !== p.market.title && <p className="mt-1 text-sm text-muted">{p.market.eventTitle}</p>}

          <div className="mt-6 flex items-end justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-sm text-fg-2">
                {action}
                <span className={`inline-flex h-5 items-center rounded px-1.5 text-[11px] font-semibold tracking-wide ${p.side === "YES" ? "bg-up-soft text-up" : "bg-down-soft text-down"}`}>{p.side}</span>
                <span className="tabular-nums">{p.quantity} × {Math.round(p.limitPrice * 100)}¢</span>
              </div>
              <div className="mt-2 flex items-baseline text-5xl font-semibold tabular-nums tracking-[-0.03em] text-fg">
                {whole}<span className="text-[0.5em] text-muted">.{frac}</span>
              </div>
            </div>
            <div className="text-right">
              <div className={`text-lg font-medium tabular-nums ${edgePts >= 0 ? "text-accent" : "text-down"}`}>{edgePts >= 0 ? "+" : ""}{edgePts} pts</div>
              <div className="text-xs text-muted">edge</div>
            </div>
          </div>

          <div className="mt-5">
            <div className="relative h-1.5 rounded-full bg-sunken">
              <div
                className="absolute inset-y-0 rounded-full bg-accent/35"
                style={{ left: `${Math.min(p.limitPrice, p.estimatedProbability) * 100}%`, width: `${Math.abs(p.estimatedProbability - p.limitPrice) * 100}%` }}
              />
              <div className="absolute top-1/2 h-3 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted" style={{ left: `${p.limitPrice * 100}%` }} />
              <div className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-bg bg-accent" style={{ left: `${p.estimatedProbability * 100}%` }} />
            </div>
            <div className="mt-2 flex justify-between text-[11px] tabular-nums text-muted">
              <span>Market <span className="text-fg-2">{pct(p.marketProbability)}</span></span>
              <span>Mayflower <span className="text-accent">{pct(p.estimatedProbability)}</span></span>
            </div>
          </div>
          <p className="mt-5 text-[13px] text-muted">Nothing is placed until you approve. These are exactly the terms that will be sent.</p>
        </section>

        <dl className="mt-6 divide-y divide-line rounded-2xl border border-line bg-surface text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 px-4 py-3">
              <dt className="text-muted">{k}</dt>
              <dd className="text-right font-medium tabular-nums text-fg">{v}</dd>
            </div>
          ))}
        </dl>

        <section className="mt-8 space-y-6 text-sm">
          <Bubble title="Thesis">{p.thesis}</Bubble>
          <Bubble title="Why this size">{p.sizingExplanation}</Bubble>
          {p.riskNotes && <Bubble title="Risks">{p.riskNotes}</Bubble>}
          {research && research.citations.length > 0 && (
            <Bubble title="Sources">
              <ul className="space-y-1">
                {research.citations.slice(0, 5).map((c) => (
                  <li key={c.url}><a className="text-fg-2 underline decoration-line-strong underline-offset-[3px] hover:text-accent" href={c.url} target="_blank" rel="noreferrer">{c.title}</a></li>
                ))}
              </ul>
            </Bubble>
          )}
        </section>

        <div className="sticky bottom-0 -mx-4 mt-8 bg-gradient-to-t from-bg via-bg to-transparent px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-6 sm:static sm:mx-0 sm:bg-none sm:px-0">
          <ApproveActions
            proposalId={p.id}
            token={t!}
            initialStatus={expired && p.status === "pending" ? "expired" : p.status}
            initialOrder={order ?? null}
          />
        </div>
      </div>
    </main>
  );
}

function Bubble({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">{title}</h2>
      <div className="mt-1.5 whitespace-pre-wrap leading-relaxed text-fg-2">{children}</div>
    </div>
  );
}
