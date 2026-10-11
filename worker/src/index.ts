import { serve } from '@hono/node-server';
import { config } from './config.js';
import { buildApp } from './app.js';
import { createServer } from './server.js';

const app = await buildApp();
const count = await app.catalog.refresh().catch((e) => { console.error('[catalog] initial refresh failed', e); return 0; });
setInterval(() => app.catalog.refresh().catch((e) => console.error('[catalog]', e)), 3 * 60e3);
if (app.ticks) app.ticks.start();

serve({ fetch: createServer(app).fetch, port: config.port });
if (config.bluebubbles.url && config.bluebubbles.allowedSenders.length === 0) {
  console.warn('[mayflower] ALLOWED_SENDERS is empty: iMessage texts are ignored (set it, or * for everyone)');
}
console.log(`[mayflower] worker on :${config.port} · ${count} contracts ·`, JSON.stringify(await app.modes()));
