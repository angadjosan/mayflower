"use client";
import { useState } from "react";
import type { AuditEvent } from "@/lib/types";
import { Button, time } from "./ui";

export function Footer({ audit, onMonitor, onReset, busy }: { audit: AuditEvent[]; onMonitor: () => void; onReset: () => void; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const recent = [...audit].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 30);
  return (
    <footer className="space-y-4 pt-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" onClick={() => setOpen(!open)}>{open ? "Hide" : "Show"} activity log ({audit.length})</Button>
        <div className="ml-auto flex gap-2">
          <Button onClick={onMonitor} disabled={busy}>Run monitor now</Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => {
              if (confirm("Reset the demo? This clears all local Mayflower data.")) onReset();
            }}
          >
            Reset demo
          </Button>
        </div>
      </div>
      {open && (
        <ul className="max-h-72 space-y-1 overflow-y-auto rounded-2xl bg-white p-4 font-mono text-xs text-stone-600 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          {recent.length === 0 && <li className="text-stone-400">No activity yet.</li>}
          {recent.map((a) => (
            <li key={a.id}>
              <span className="text-stone-400">{time(a.createdAt)}</span> <span className="text-imsg">{a.actor}</span> {a.action}
              {a.ref ? <span className="text-stone-400"> · {a.ref}</span> : null}
            </li>
          ))}
        </ul>
      )}
      <p className="text-center text-xs text-stone-400">
        No promises of profit. Contracts can lose their full cost. Every trade requires your explicit approval.
      </p>
    </footer>
  );
}
