import "server-only";
import { getContainer as baseGetContainer, type Container } from "@mayflower/core";
import { SupabaseRepo, createServiceClient, hasSupabaseConfig } from "@mayflower/db";

const g = globalThis as unknown as { __mayflowerWebContainer?: Container };

/** App-level container: Supabase-backed repo when configured, in-memory otherwise. */
export function getContainer(): Container {
  if (g.__mayflowerWebContainer) return g.__mayflowerWebContainer;
  g.__mayflowerWebContainer = hasSupabaseConfig() ? baseGetContainer({ repo: new SupabaseRepo(createServiceClient()) }) : baseGetContainer();
  return g.__mayflowerWebContainer;
}
