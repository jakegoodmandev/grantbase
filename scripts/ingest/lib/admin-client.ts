import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Service-role Supabase client for ingestion. It authenticates with the secret
// key, which BYPASSES row-level security — that is exactly why the catalog
// write policies are locked down. This key must never reach the browser; these
// scripts run only under `bun run` (see scripts/ingest/run.ts).
export function adminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY (set them in .env.local)",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
