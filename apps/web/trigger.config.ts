import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF ?? "proj_replace_me",
  dirs: ["./trigger"],
  runtime: "node",
  maxDuration: 600,
  retries: { enabledInDev: false, default: { maxAttempts: 2, minTimeoutInMs: 2000, maxTimeoutInMs: 20000, factor: 2, randomize: true } },
});
