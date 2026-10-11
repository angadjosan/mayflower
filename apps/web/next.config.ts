import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@mayflower/shared", "@mayflower/risk", "@mayflower/agents", "@mayflower/context", "@mayflower/gemini-markets"],
  // Native/WASM and ESM-only server libraries are loaded at runtime instead of bundled.
  serverExternalPackages: ["@electric-sql/pglite", "@gemini-markets/sdk", "postgres", "ws", "context.dev", "@google/genai"],
  outputFileTracingRoot: path.resolve(process.cwd(), "../.."),
  outputFileTracingIncludes: { "/**": ["../../supabase/migrations/*.sql"] },
};

export default nextConfig;
