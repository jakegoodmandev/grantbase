import { adminClient } from "./lib/admin-client.js";
import type { Adapter } from "./lib/types.js";
import { canadianHeritageAdapter } from "./sources/canadian-heritage.js";

// Registry of available source adapters. Add new sources here.
const ADAPTERS: Record<string, Adapter> = {
  [canadianHeritageAdapter.source]: canadianHeritageAdapter,
};

function parseSource(argv: string[]): string | undefined {
  for (const arg of argv) {
    if (arg.startsWith("--source=")) return arg.slice("--source=".length);
  }
  return undefined;
}

async function main() {
  const source = parseSource(process.argv.slice(2));
  if (!source || !ADAPTERS[source]) {
    const available = Object.keys(ADAPTERS).join(", ");
    console.error(
      `Usage: bun run ingest --source=<${available}>\n` +
        (source ? `Unknown source: ${source}` : "Missing --source"),
    );
    process.exit(1);
  }

  const adapter = ADAPTERS[source];
  const db = adminClient();
  const log = (msg: string) => console.log(msg);

  // Open a sync_runs row for observability.
  const { data: run, error: runErr } = await db
    .from("sync_runs")
    .insert({ source, status: "running" })
    .select("id")
    .single();
  if (runErr) throw new Error(`could not open sync_run: ${runErr.message}`);
  const syncRunId = run.id as string;

  log(`▶ ingest ${source} (sync_run ${syncRunId})`);
  const ctx = { db, syncRunId, log };

  try {
    log("• extract → raw_ingest");
    const fetched = await adapter.extract(ctx);
    log("• normalize → catalog");
    const upserted = await adapter.normalize(ctx);

    await db
      .from("sync_runs")
      .update({
        status: "success",
        finished_at: new Date().toISOString(),
        items_fetched: fetched,
        items_upserted: upserted,
      })
      .eq("id", syncRunId);
    log(`✓ done: ${fetched} fetched, ${upserted} catalog rows upserted`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .from("sync_runs")
      .update({
        status: "error",
        finished_at: new Date().toISOString(),
        error_text: message,
      })
      .eq("id", syncRunId);
    log(`✗ failed: ${message}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
