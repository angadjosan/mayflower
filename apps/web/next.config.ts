import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source; let Next compile them.
  transpilePackages: ["@mayflower/shared", "@mayflower/risk", "@mayflower/context", "@mayflower/gemini-markets", "@mayflower/messaging", "@mayflower/db", "@mayflower/agents", "@mayflower/core"],
  serverExternalPackages: ["@google/genai"],
  turbopack: {
    rules: { "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" } },
  },
};

export default nextConfig;
