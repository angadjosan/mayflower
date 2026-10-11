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
      <main className="mx-auto max-w-lg p-6 pt-16 text-center">
        <div className="text-4xl" aria-hidden>🔗</div>
        <h1 className="mt-2 text-xl font-bold">Link not valid</h1>
        <p className="mt-2 text-sm text-stone-500">This approval link is invalid or incomplete. Ask Mayflower for a fresh proposal.</p>
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

  return (
    <main className="mx-auto min-h-screen max-w-lg p-4 sm:p-6">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-money-400 to-money-700 text-sm font-bold text-white" aria-hidden>M</div>
          <span className="text-sm font-bold tracking-tight">Mayflower</span>
        </div>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${simulated ? "bg-amber-100 text-amber-800" : "bg-imsg/10 text-imsg-dark"}`}>
          {simulated ? (venue === "gemini" ? "Simulated" : `Simulated · ${venue === "polymarket" ? "Polymarket" : "Hyperliquid"}`) : venueLabel(mode, venue)}
        </span>
      </div>

      <section className="animate-rise rounded-[28px] bg-white px-6 pb-6 pt-8 text-center shadow-[0_1px_2px_rgba(0,0,0,0.04),0_16px_40px_-20px_rgba(0,0,0,0.2)]">
        <div
          className={`mx-auto inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-bold ${
            p.side === "YES" ? "bg-money-100 text-money-700" : "bg-rose-100 text-rose-600"
          }`}
        >
          {action} {p.quantity} {p.side}
        </div>
        <div className="mt-3 text-6xl font-extrabold tracking-tight tabular-nums">{usd(p.costUsd)}</div>
        <p className="mx-auto mt-3 max-w-sm text-[15px] font-semibold leading-snug text-stone-800">{p.market.title}</p>
        {p.market.eventTitle && p.market.eventTitle !== p.market.title && <p className="mt-0.5 text-sm text-stone-500">{p.market.eventTitle}</p>}
        <div className="mt-4 flex justify-center gap-2 text-xs font-semibold">
          <span className="rounded-full bg-stone-100 px-2.5 py-1 text-stone-600">Market {pct(p.marketProbability)}</span>
          <span className="rounded-full bg-money-100 px-2.5 py-1 text-money-700">Mayflower {pct(p.estimatedProbability)}</span>
        </div>
        <p className="mt-4 text-xs text-stone-500">Nothing is placed until you approve. These are exactly the terms that will be sent.</p>
      </section>

      <dl className="mt-4 divide-y divide-stone-100 overflow-hidden rounded-2xl bg-white text-sm shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 px-4 py-2.5">
            <dt className="text-stone-500">{k}</dt>
            <dd className="text-right font-semibold">{v}</dd>
          </div>
        ))}
      </dl>

      <section className="mt-4 space-y-2 text-sm">
        <Bubble title="💡 Thesis">{p.thesis}</Bubble>
        <Bubble title="📏 Why this size">{p.sizingExplanation}</Bubble>
        {p.riskNotes && <Bubble title="⚠️ Risks">{p.riskNotes}</Bubble>}
        {research && research.citations.length > 0 && (
          <Bubble title="📚 Sources">
            <ul className="mt-0.5 space-y-0.5">
              {research.citations.slice(0, 5).map((c) => (
                <li key={c.url}><a className="text-imsg underline decoration-imsg/30 underline-offset-2" href={c.url} target="_blank" rel="noreferrer">{c.title}</a></li>
              ))}
            </ul>
          </Bubble>
        )}
      </section>

      <div className="mt-6 pb-8">
        <ApproveActions
          proposalId={p.id}
          token={t!}
          initialStatus={expired && p.status === "pending" ? "expired" : p.status}
          initialOrder={order ?? null}
        />
      </div>
    </main>
  );
}

function Bubble({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="max-w-[92%] rounded-[20px] rounded-bl-[6px] bg-bubble px-4 py-2.5">
      <h2 className="text-xs font-bold text-stone-500">{title}</h2>
      <div className="mt-0.5 whitespace-pre-wrap leading-snug text-stone-900">{children}</div>
    </div>
  );
}
