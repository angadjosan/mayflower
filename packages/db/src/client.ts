import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { optionalEnv, requireEnv } from "@mayflower/shared";

/** Server-side client with the service role. Never ship this to the browser. */
export function createServiceClient(): SupabaseClient {
  return createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
}

export function hasSupabaseConfig(): boolean {
  return Boolean(optionalEnv("NEXT_PUBLIC_SUPABASE_URL") && optionalEnv("SUPABASE_SERVICE_ROLE_KEY"));
}
