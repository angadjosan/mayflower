import crypto from "crypto";
import { load } from "@/lib/db";
import { exchangeMode } from "@/lib/exchange";
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
  const db = load();
  const p = db.proposals.find((x) => x.id === id);

  if (!p || !tokenOk(p.approvalToken, t)) {
    return (
      <main className="mx-auto max-w-lg p-6">
        <h1 className="text-xl font-semibold">Link not valid</h1>
        <p className="mt-2 text-sm text-neutral-500">This approval link is invalid or incomplete. Ask Mayflower for a fresh proposal.</p>
      </main>
    );
  }

  const order = db.orders.find((o) => o.proposalId === p.id);
  const research = db.research.find((r) => r.id === p.researchId);
  const expired = new Date(p.expiresAt).getTime() < Date.now();
  const simulated = String(exchangeMode) !== "sandbox";
  const action = p.kind === "open" ? "Buy" : "Sell";
  const maxLoss = p.kind === "open" ? p.costUsd : 0;

  const rows: [string, string][] = [
    ["Event", p.market.eventTitle],
    ["Contract", p.market.title],
    ["Order", `${action} ${p.quantity} ${p.side} contracts`],
    ["Limit price", `${usd(p.limitPrice)} per contract`],
    ["Total cost", usd(p.costUsd)],
    ["Max loss", p.kind === "open" ? usd(maxLoss) : "n/a (closing)"],
    ["Market probability", pct(p.marketProbability)],
    [`Mayflower estimate (${p.side} wins)`, pct(p.estimatedProbability)],
    ["Edge", `${(p.edge * 100).toFixed(1)} pts`],
    ["Market closes", p.market.expiresAt ? new Date(p.market.expiresAt).toLocaleString() : "unknown"],
    ["Proposal expires", new Date(p.expiresAt).toLocaleString()],
  ];

  return (
    <main className="mx-auto max-w-lg p-4 sm:p-6">
      <div className="mb-4 flex items-center justify-between">
        <span className="text-sm font-semibold tracking-wide">Mayflower</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${simulated ? "bg-amber-100 text-amber-800" : "bg-sky-100 text-sky-800"}`}>
          {simulated ? "Simulated" : "Gemini sandbox – shared account"}
        </span>
      </div>
      <h1 className="text-xl font-semibold">Confirm this exact order</h1>
      <p className="mt-1 text-sm text-neutral-500">Nothing is placed until you approve. The terms below are exactly what will be sent.</p>

      <dl className="mt-4 divide-y divide-neutral-200 rounded-xl border border-neutral-200 text-sm dark:divide-neutral-800 dark:border-neutral-800">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 px-4 py-2">
            <dt className="text-neutral-500">{k}</dt>
            <dd className="text-right font-medium">{v}</dd>
          </div>
        ))}
      </dl>

      <section className="mt-4 space-y-3 text-sm">
        <div>
          <h2 className="font-semibold">Thesis</h2>
          <p className="mt-1 whitespace-pre-wrap text-neutral-700 dark:text-neutral-300">{p.thesis}</p>
        </div>
        <div>
          <h2 className="font-semibold">Why this size</h2>
          <p className="mt-1 whitespace-pre-wrap text-neutral-700 dark:text-neutral-300">{p.sizingExplanation}</p>
        </div>
        {p.riskNotes && (
          <div>
            <h2 className="font-semibold">Risks</h2>
            <p className="mt-1 whitespace-pre-wrap text-neutral-700 dark:text-neutral-300">{p.riskNotes}</p>
          </div>
        )}
        {research && research.citations.length > 0 && (
          <div>
            <h2 className="font-semibold">Sources</h2>
            <ul className="mt-1 list-disc pl-5">
              {research.citations.slice(0, 5).map((c) => (
                <li key={c.url}><a className="text-sky-700 underline dark:text-sky-400" href={c.url} target="_blank" rel="noreferrer">{c.title}</a></li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <div className="mt-6">
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
