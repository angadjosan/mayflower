"use client";
import type { AuditEvent } from "@/lib/types";
import { Button, Empty, Logo, smsHref, IMESSAGE_ADDRESS, time } from "./ui";

export function ActivityLog({ audit }: { audit: AuditEvent[] }) {
  const recent = [...audit].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 40);
  if (!recent.length) return <Empty>No activity yet.</Empty>;
  return (
    <ul className="divide-y divide-line">
      {recent.map((a) => (
        <li key={a.id} className="flex items-baseline gap-3 py-2.5 text-[13px]">
          <span className="num w-28 shrink-0 text-xs text-subtle">{time(a.createdAt)}</span>
          <span className="w-14 shrink-0 text-xs text-muted">{a.actor}</span>
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg-2" title={a.ref}>
            {a.action}
            {a.ref ? <span className="text-subtle"> · {a.ref}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function Footer({ onMonitor, onReset, busy }: { onMonitor: () => void; onReset: () => void; busy: boolean }) {
  return (
    <footer className="border-t border-line pt-8">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-md">
          <div className="flex items-center gap-2">
            <Logo size={20} />
            <span className="text-sm font-semibold text-fg">Mayflower</span>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-muted">
            Everything here runs on test funds: the Gemini sandbox and a Hyperliquid test wallet. No promises of profit;
            contracts can lose their full cost. Every trade needs your explicit approval.
          </p>
          <p className="mt-2 text-xs text-muted">
            Talk to Mayflower in iMessage at <a href={smsHref()} className="text-fg-2 underline decoration-line-strong underline-offset-2 hover:text-fg">{IMESSAGE_ADDRESS}</a>.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={onMonitor} disabled={busy}>Run monitor</Button>
          <Button
            size="sm"
            variant="danger"
            disabled={busy}
            onClick={() => { if (confirm("Reset the demo? This clears all local Mayflower data.")) onReset(); }}
          >
            Reset demo
          </Button>
        </div>
      </div>
    </footer>
  );
}
