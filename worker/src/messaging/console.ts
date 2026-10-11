import type { Messenger } from '../core/ports.js';
import type { OutboundMessage } from '../core/types.js';

export class ConsoleMessenger implements Messenger {
  readonly mode = 'console' as const;
  readonly outbox: OutboundMessage[] = [];

  async send(msg: OutboundMessage): Promise<void> {
    this.outbox.push(msg);
    const voice = msg.audio ? ` [voice note ${msg.audio.data.length} bytes]` : '';
    console.log(`→ ${msg.to}: ${msg.text}${voice}`);
  }

  drain(to?: string): OutboundMessage[] {
    const taken = to ? this.outbox.filter((m) => m.to === to) : this.outbox.slice();
    for (const m of taken) this.outbox.splice(this.outbox.indexOf(m), 1);
    return taken;
  }
}
