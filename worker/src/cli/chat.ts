// Text Mayflower from the terminal: `npm run chat -- +15551234567` (worker must be running).
import { createInterface } from 'node:readline/promises';

const worker = process.env.WORKER_URL ?? 'http://localhost:8787';
const from = process.argv[2] ?? '+15550000000';
const rl = createInterface({ input: process.stdin, output: process.stdout });
console.log(`chatting as ${from} → ${worker} (Ctrl-C to quit)`);
for (;;) {
  const text = await rl.question('you> ');
  if (!text.trim()) continue;
  const res = await fetch(`${worker}/dev/message`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-dev-secret': process.env.WEBHOOK_SECRET ?? '' },
    body: JSON.stringify({ from, text }),
  });
  const body = await res.json().catch(() => ({ replies: [`HTTP ${res.status}`] }));
  for (const r of body.replies ?? [JSON.stringify(body)]) console.log(`mayflower> ${r}\n`);
}
