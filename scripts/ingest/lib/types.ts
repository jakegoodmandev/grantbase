import type { SupabaseClient } from "@supabase/supabase-js";

// Shared context threaded through every adapter's extract + normalize phases.
export type IngestContext = {
  db: SupabaseClient;
  syncRunId: string;
  log: (msg: string) => void;
};

// Every source implements the same two-phase contract:
//   extract   — pull from the source, land raw rows in `raw_ingest`
//   normalize — map `raw_ingest` rows into the catalog, upserting idempotently
export type Adapter = {
  source: string;
  extract: (ctx: IngestContext) => Promise<number>; // rows landed
  normalize: (ctx: IngestContext) => Promise<number>; // catalog rows upserted
};

// Split an array into fixed-size chunks (for batched upserts).
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
