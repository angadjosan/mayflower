/** Outbound messaging abstraction so web chat and voice can share the agent. */
export interface OutboundChannel {
  readonly name: "imessage" | "web" | "voice";
  send(to: { handle?: string; chatGuid?: string; userId: string }, text: string): Promise<{ externalId: string | null }>;
  healthy(): Promise<boolean>;
}

/** Collects messages in memory — used for tests and as the web-chat mirror. */
export class InMemoryChannel implements OutboundChannel {
  readonly name = "web" as const;
  sent: Array<{ userId: string; text: string }> = [];
  async send(to: { userId: string }, text: string) { this.sent.push({ userId: to.userId, text }); return { externalId: null }; }
  async healthy() { return true; }
}
