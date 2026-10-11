"use client";
import type { AuditEvent } from "@/lib/types";
import { Feed } from "./Feed";
import { Icon, type IconName } from "./icons";
import { IMESSAGE_ADDRESS, IconButton, InfoTip, Logo, relTime, smsHref } from "./ui";

const ACTOR: Record<AuditEvent["actor"], { icon: IconName; label: string }> = {
  user: { icon: "user", label: "You" },
  agent: { icon: "sparkle", label: "Mayflower" },
  system: { icon: "bolt", label: "System" },
};

export function ActivityLog({ audit }: { audit: AuditEvent[] }) {
  const recent = [...audit].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 40);
  if (!recent.length) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-dashed border-line-strong px-4 py-5 text-sm text-muted">
        <Icon name="pulse" className="h-5 w-5 text-subtle" />No activity yet
      </div>
    );
  }
  return (
    <Feed
      items={recent.map((a) => {
        const who = ACTOR[a.actor] ?? ACTOR.system;
        return {
          id: a.id,
          icon: <Icon name={who.icon} className="h-4 w-4" />,
          title: <span className="font-medium first-letter:uppercase">{a.action.replace(/[._]/g, " ")}</span>,
          meta: relTime(a.createdAt),
        };
      })}
    />
  );
}

export function Footer({ onMonitor, onReset, busy }: { onMonitor: () => void; onReset: () => void; busy: boolean }) {
  return (
    <footer className="flex items-center gap-2 border-t border-line pt-6">
      <Logo size={20} />
      <span className="text-sm font-medium text-fg">Mayflower</span>
      <InfoTip title="About Mayflower">
        <p>Everything here runs on test funds: the Gemini sandbox and a Hyperliquid test wallet. Items marked Sim never reach an exchange.</p>
        <p>No promises of profit. A contract can lose its full cost. Mayflower never places a trade without your explicit approval, and exit alerts are suggestions, not guaranteed stop orders.</p>
        <p>
          Talk to Mayflower in iMessage at{" "}
          <a href={smsHref()} className="text-fg underline decoration-line-strong underline-offset-2">{IMESSAGE_ADDRESS}</a>.
        </p>
      </InfoTip>
      <div className="ml-auto flex items-center gap-1">
        <IconButton label="Run monitor now" onClick={onMonitor} disabled={busy}><Icon name="play" className="h-3.5 w-3.5" /></IconButton>
        <IconButton
          label="Reset demo"
          className="hover:text-down"
          disabled={busy}
          onClick={() => { if (confirm("Reset the demo? This clears all local Mayflower data.")) onReset(); }}
        >
          <Icon name="reset" />
        </IconButton>
      </div>
    </footer>
  );
}
