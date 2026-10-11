import Link from 'next/link';
import { getCase, num, pct, usd, when } from '@/lib';
import { Badge, Card, Offline, VerdictBadge } from '@/components/ui';
import Refresh from '@/components/Refresh';
import TickChart from '@/components/TickChart';

export const dynamic = 'force-dynamic';

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await getCase(id);
  if (!c) return (<><Refresh /><Offline /></>);
  const { verdict: v, market: m, research: r, numbers: n, order: o } = c;
  const stance = { for: 'bg-green-100 text-green-800', against: 'bg-red-100 text-red-800', neutral: 'bg-gray-100 text-gray-700' };
  const ticks = c.ticks
    .map((t) => {
      const p = t.last ?? (t.bid != null && t.ask != null ? (t.bid + t.ask) / 2 : null);
      return p == null ? null : { t: new Date(t.ts).toLocaleTimeString(), p };
    })
    .filter((x): x is { t: string; p: number } => x !== null);
  const rows: [string, string][] = [
    ['Market price', pct(r?.pMarket ?? v.pMarket)],
    ['Model estimate', pct(r?.pModel)],
    ['Model weight (w)', r?.w == null ? '—' : r.w.toFixed(2)],
    ['Final estimate', pct(r?.pFinal ?? v.pFinal)],
    ['Edge', num(n.edge, (x) => `${(x * 100).toFixed(1)} pts`)],
    ['Spread', num(n.spread, pct)],
    ['Stake', usd((n.stake as number | undefined) ?? v.stake ?? c.proposal?.stake)],
    ['Max loss', usd((n.maxLoss as number | undefined) ?? c.proposal?.maxLoss)],
  ];
  return (
    <div className="space-y-6">
      <Link href="/" className="text-sm text-gray-500 hover:underline">← Overview</Link>
      <div>
        <VerdictBadge type={v.type} />
        <h1 className="mt-2 text-2xl font-semibold">{v.belief}</h1>
        <p className="mt-2 text-gray-600">{v.reasoning}</p>
      </div>

      {m && (
        <Card title="Market">
          <div className="flex flex-wrap items-center gap-2">
            <b>{m.title}</b>
            {m.sandboxListed ? <Badge tone="green">sandbox</Badge> : <Badge>production data, simulated fill</Badge>}
          </div>
          <p className="mt-2 text-sm text-gray-600">{m.rules ?? 'No rules text.'}</p>
          <p className="mt-1 text-sm text-gray-500">Expires {when(m.expiry)}</p>
        </Card>
      )}

      <Card title="The numbers">
        <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {rows.map(([k, val]) => (
            <div key={k}><dt className="text-xs text-gray-500">{k}</dt><dd className="text-lg font-semibold">{val}</dd></div>
          ))}
        </dl>
      </Card>

      {r && (
        <>
          <div className="grid gap-6 md:grid-cols-2">
            <Card title="For (supports YES)">
              <ul className="list-disc space-y-1 pl-5 text-sm">{r.forPoints.length ? r.forPoints.map((p, i) => <li key={i}>{p}</li>) : <li className="list-none text-gray-500">—</li>}</ul>
            </Card>
            <Card title="Against (supports NO)">
              <ul className="list-disc space-y-1 pl-5 text-sm">{r.againstPoints.length ? r.againstPoints.map((p, i) => <li key={i}>{p}</li>) : <li className="list-none text-gray-500">—</li>}</ul>
            </Card>
          </div>

          <Card title="Sources">
            {r.sources.length === 0 ? <p className="text-gray-500">No sources.</p> : (
              <ul className="divide-y divide-gray-100 text-sm">
                {r.sources.map((s, i) => (
                  <li key={i} className="py-2">
                    <a href={s.url} target="_blank" rel="noreferrer" className="font-medium text-indigo-600 hover:underline">{s.title}</a>{' '}
                    <span className={`rounded px-1.5 py-0.5 text-xs ${stance[s.stance]}`}>{s.stance}</span>
                    <div className="text-xs text-gray-500">published {when(s.publishedAt)} · retrieved {when(s.retrievedAt)}</div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {r.critic && (
            <Card title={`Critic (${r.critic.severity})`}>
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {r.critic.notes.map((x, i) => <li key={i}>{x}</li>)}
                {r.critic.resolutionMismatch && <li>Contract may not resolve on this belief.</li>}
                {r.critic.staleEvidence && <li>Evidence may be stale.</li>}
                {!r.critic.notes.length && !r.critic.resolutionMismatch && !r.critic.staleEvidence && <li className="list-none text-gray-500">No concerns.</li>}
              </ul>
            </Card>
          )}
        </>
      )}

      <Card title="Order">
        {o ? (
          <div className="space-y-1 text-sm">
            <div className="flex items-center gap-2">
              <b className="uppercase">{o.status.replaceAll('_', ' ')}</b>
              {o.simulated && <Badge>SIMULATED</Badge>}
            </div>
            <div className="text-gray-600">Filled {o.filledQty} @ {pct(o.avgPrice)}</div>
            {o.error && <div className="text-red-700">{o.error}</div>}
          </div>
        ) : c.proposal ? (
          <p className="text-sm text-gray-600">Proposed, not placed: {c.proposal.side.toUpperCase()} x{c.proposal.qty} @ {pct(c.proposal.limitPrice)} ({c.proposal.status}).</p>
        ) : <p className="text-gray-500">No order.</p>}
      </Card>

      {ticks.length > 1 && <Card title="Price history"><TickChart data={ticks} /></Card>}
    </div>
  );
}
