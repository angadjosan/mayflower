// Builds every dependency once and picks real vs fallback adapters from env.
// Fallbacks are labeled in /health and on the dashboard; nothing pretends to be live.
import { config } from './config.js';
import { openDb, type Db } from './db/index.js';
import type { Brain, Catalog, Executor, Messenger, Voice } from './core/ports.js';
import { GeminiCatalog } from './gemini/catalog.js';
import { SandboxExecutor, SimExecutor } from './gemini/executor.js';
import { TickRecorder } from './gemini/ticks.js';
import { GoogleLlm, FakeLlm } from './brain/llm.js';
import { ContextDevResearch, NoResearch } from './brain/contextdev.js';
import { createBrain } from './brain/brain.js';
import { BlueBubblesMessenger } from './messaging/bluebubbles.js';
import { ConsoleMessenger } from './messaging/console.js';
import { ElevenLabsVoice, NoVoice } from './voice/elevenlabs.js';
import type { ModesInfo } from './core/api.js';

export interface App {
  db: Db;
  catalog: Catalog;
  executor: Executor;      // sandbox when keys exist, otherwise the simulator
  sim: Executor;           // always available for markets the sandbox does not list
  brain: Brain;
  llmMode: 'google' | 'fake';
  researchMode: 'contextdev' | 'none';
  messenger: Messenger;
  voice: Voice;
  ticks: TickRecorder | null;
  modes(): Promise<ModesInfo>;
}

export async function buildApp(opts: { recordTicks?: boolean } = {}): Promise<App> {
  const db = await openDb();
  const catalog = new GeminiCatalog(db);
  const sim = new SimExecutor(catalog);
  let executor: Executor = sim;
  if (config.gemini.apiKey && config.gemini.apiSecret) {
    const sandbox = new SandboxExecutor(config.gemini.apiKey, config.gemini.apiSecret);
    try { await sandbox.init(); executor = sandbox; } catch (e) { console.error('[gemini] sandbox init failed, using simulator:', e); }
  }
  const llm = config.googleApiKey ? new GoogleLlm(config.googleApiKey, config.llmModel, config.llmFastModel) : new FakeLlm();
  const research = config.contextDevKey ? new ContextDevResearch(config.contextDevKey) : new NoResearch();
  const messenger = config.bluebubbles.url && config.bluebubbles.password
    ? new BlueBubblesMessenger(config.bluebubbles.url, config.bluebubbles.password)
    : new ConsoleMessenger();
  const voice = config.elevenlabs.apiKey ? new ElevenLabsVoice(config.elevenlabs.apiKey, config.elevenlabs.voiceId) : new NoVoice();
  const ticks = (opts.recordTicks ?? config.recordTicks) ? new TickRecorder(db, catalog) : null;

  const app: App = {
    db, catalog, executor, sim, brain: createBrain(llm, research), llmMode: llm.mode, researchMode: research.mode,
    messenger, voice, ticks,
    async modes() {
      const [{ n }] = await db.query<{ n: number }>('select count(*)::int as n from markets');
      const [{ t }] = await db.query<{ t: number }>('select count(*)::int as t from ticks');
      return {
        db: db.mode, executor: executor.mode, llm: llm.mode, research: research.mode,
        messenger: messenger.mode, voice: voice.mode, catalogContracts: n, ticksRecorded: t,
      };
    },
  };
  return app;
}
