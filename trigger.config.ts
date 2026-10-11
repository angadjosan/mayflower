import { defineConfig } from "@trigger.dev/sdk";

// Trigger.dev runs scheduled jobs that call back into the app (job logic stays in Next.js routes).
// Local: `npm run trigger:dev`. Deploy: `npx trigger.dev@latest deploy`.
export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF || "proj_set_TRIGGER_PROJECT_REF",
  dirs: ["./src/trigger"],
  maxDuration: 300,
  retries: {
    enabledInDev: false,
    default: { maxAttempts: 3, minTimeoutInMs: 1000, maxTimeoutInMs: 10000, factor: 2, randomize: true },
  },
});
