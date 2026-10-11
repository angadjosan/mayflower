import Link from 'next/link';
import { getOverview, pct, usd } from '@/lib';
import { Badge, Card, Offline, VerdictBadge, verdictLabel } from '@/components/ui';
import Refresh from '@/components/Refresh';
import type { VerdictType } from '../../worker/src/core/types';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const o = await getOverview();
  if (!o) return (<><Refresh /><Offline /></>);
  const m = o.modes;
  const pnlCls = (n: number) => (n > 0 ? 'text-green-700' : n < 0 ? 'text-red-700' : '');
  const chips: [string, string, 'amber' | 'green' | 'gray'][] = [
    ['Executor', m.executor === 'sandbox' ? 'SANDBOX' : 'SIMULATED', m.executor === 'sandbox' ? 'green' : 'amber'],
    ['LLM', m.llm, m.llm === 'fake' ? 'amber' : 'green'],
    ['Research', m.research, m.research === 'none' ? 'amber' : 'green'],
    ['Messenger', m.messenger, m.messenger === 'console' ? 'amber' : 'green'],
    ['Voice', m.voice, m.voice === 'none' ? 'gray' : 'green'],
    ['DB', m.db, 'gray'],
    ['Contracts', String(m.catalogContracts), 'gray'],
    ['Ticks', String(m.ticksRecorded), 'gray'],
  ];
  return (
    <div className="space-y-8">
      <Refresh />
      <div className="flex flex-wrap gap-2">
        {chips.map(([k, v, tone]) => (
          <span key={k} className="flex items-center gap-1.5 text-sm text-gray-500">
            {k}: <Badge tone={tone}>{v.toUpperCase()}</Badge>
          </span>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          ['Invested', usd(o.totals.invested), ''],
          ['Unrealized P&L', usd(o.totals.unrealizedPnl), pnlCls(o.totals.unrealizedPnl)],
          ['Realized P&L', usd(o.totals.realizedPnl), pnlCls(o.totals.realizedPnl)],
          ['Open positions', String(o.totals.openPositions), ''],
        ].map(([k, v, c]) => (
          <Card key={k}>
            <div className="text-sm text-gray-500">{k}</div>
            <div className={`mt-1 text-2xl font-semibold ${c}`}>{v}</div>
          </Card>
        ))}
      </div>

      <Card title="Positions">
        {o.positions.length === 0 ? <p className="text-gray-500">No positions yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-gray-500"><tr>
                <th className="py-2 pr-3">Market</th><th className="pr-3">Side</th><th className="pr-3">Qty</th>
                <th className="pr-3">Cost</th><th className="pr-3">Mark</th><th className="pr-3">P&L</th><th></th>
              </tr></thead>
              <tbody>
                {o.positions.map((p) => (
                  <tr key={p.id} className="border-t border-gray-100">
                    <td className="py-2 pr-3">
                      {p.verdictId ? <Link className="hover:underline" href={`/case/${p.verdictId}`}>{p.title}</Link> : p.title}
                    </td>
                    <td className="pr-3 uppercase">{p.side}</td>
                    <td className="pr-3">{p.qty}</td>
                    <td className="pr-3">{pct(p.costBasis)}</td>
                    <td className="pr-3">{pct(p.mark)}</td>
                    <td className={`pr-3 ${pnlCls(p.unrealizedPnl + p.realizedPnl)}`}>{usd(p.unrealizedPnl + p.realizedPnl)}</td>
                    <td>{p.simulated && <Badge>SIMULATED</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Pending proposals">
        {o.proposals.length === 0 ? <p className="text-gray-500">Nothing awaiting approval.</p> : (
          <ul className="divide-y divide-gray-100 text-sm">
            {o.proposals.map((p) => (
              <li key={p.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span>{p.title} <span className="uppercase text-gray-500">{p.side}</span> x{p.qty} @ {pct(p.limitPrice)}</span>
                <span className="text-gray-500">stake {usd(p.stake)} · max loss {usd(p.maxLoss)} · {p.status}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="flex flex-wrap gap-4 text-sm text-gray-500">
        {(Object.keys(o.verdictCounts) as VerdictType[]).map((t) => (
          <span key={t}>{verdictLabel(t)}: <b className="text-gray-900">{o.verdictCounts[t]}</b></span>
        ))}
      </div>

      <Card title="Recent verdicts">
        {o.verdicts.length === 0 ? <p className="text-gray-500">No verdicts yet.</p> : (
          <ul className="divide-y divide-gray-100">
            {o.verdicts.map((v) => (
              <li key={v.id} className="py-3">
                <Link href={`/case/${v.id}`} className="block hover:bg-gray-50">
                  <div className="flex items-center gap-3"><VerdictBadge type={v.type} />
                    <span className="text-xs text-gray-400">{new Date(v.createdAt).toLocaleString()}</span></div>
                  <p className="mt-1 font-medium">{v.belief}</p>
                  <p className="text-sm text-gray-500">
                    {v.title ?? 'No matching market'}
                    {v.pMarket != null && <> · market {pct(v.pMarket)} vs ours {pct(v.pFinal)}</>}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
