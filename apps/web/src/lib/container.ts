import "server-only";
import { getContainer as baseGetContainer, type Container } from "@mayflower/core";
import { SupabaseRepo, createServiceClient, hasSupabaseConfig } from "@mayflower/db";

let container: Container | null = null;

/** App-level container: Supabase-backed repo when configured, in-memory otherwise. */
export function getContainer(): Container {
  if (container) return container;
  container = hasSupabaseConfig() ? baseGetContainer({ repo: new SupabaseRepo(createServiceClient()) }) : baseGetContainer();
  return container;
}
