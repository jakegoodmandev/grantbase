import { type CkanRecord, datastorePages } from "../lib/ckan.js";
import { type Adapter, chunk, type IngestContext } from "../lib/types.js";

// Canadian Heritage (owner_org "pch") slice of the federal Proactive Disclosure
// of Grants & Contributions, via the open.canada.ca CKAN datastore.
//
// Modeling: funder -> program -> award maps onto foundations -> grants ->
// past_awards. Each distinct program (prog_name_en) becomes one catalog `grants`
// row with status 'closed' (these are historical instances, not live calls);
// each disclosure becomes a `past_awards` row hung off its program.
const SOURCE = "canadian-heritage";
const RESOURCE_ID = "1d15a62f-5656-49ad-8c88-f40ce689d831";

// "Recent" = the last three fiscal years (Canadian FY starts April 1). The
// datastore only supports exact-match filters, so we sort by start date
// descending and stop once we cross this cutoff.
const CUTOFF_START_DATE = "2023-04-01";

const FOUNDATION = {
  name: "Canadian Heritage",
  description:
    "Federal department (Department of Canadian Heritage) funding arts, culture, heritage, sport, and official-languages programs.",
  website: "https://www.canada.ca/en/canadian-heritage.html",
};

function nowIso(): string {
  return new Date().toISOString();
}

function programSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
}

function toNumeric(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toDate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
}

// ---- Phase 1: extract → raw_ingest -----------------------------------------
async function extract(ctx: IngestContext): Promise<number> {
  const { db, syncRunId, log } = ctx;
  let landed = 0;
  let reachedOld = false;

  for await (const page of datastorePages({
    resourceId: RESOURCE_ID,
    filters: { owner_org: "pch" },
    // Secondary sort on the unique _id makes offset paging deterministic —
    // without a unique tiebreaker, rows sharing a start date can overlap across
    // pages (duplicate reads) or be skipped entirely.
    sort: "agreement_start_date desc, _id asc",
    pageSize: 1000,
  })) {
    const kept: CkanRecord[] = [];
    for (const rec of page) {
      const start = (rec.agreement_start_date as string) || "";
      if (start && start < CUTOFF_START_DATE) {
        reachedOld = true; // sorted desc → everything after is older too
        continue;
      }
      if (!start) continue; // undated rows: skip, keep paging
      kept.push(rec);
    }

    for (const batch of chunk(kept, 500)) {
      const rows = batch.map((rec) => ({
        source: SOURCE,
        source_external_id: String(rec._id),
        payload: rec,
        sync_run_id: syncRunId,
        fetched_at: nowIso(),
      }));
      const { error } = await db
        .from("raw_ingest")
        .upsert(rows, { onConflict: "source,source_external_id" });
      if (error) throw new Error(`raw_ingest upsert failed: ${error.message}`);
      landed += rows.length;
    }
    log(`  landed ${landed} records…`);

    if (reachedOld) break;
  }

  return landed;
}

// ---- Phase 2: normalize raw_ingest → catalog -------------------------------
async function readRawPayloads(ctx: IngestContext): Promise<CkanRecord[]> {
  const { db } = ctx;
  const out: CkanRecord[] = [];
  const size = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await db
      .from("raw_ingest")
      .select("payload")
      .eq("source", SOURCE)
      // Stable order is required: range() pagination without an ORDER BY returns
      // an arbitrary, overlapping subset across pages, so normalize would process
      // a different set each run and past_awards would never converge.
      .order("id", { ascending: true })
      .range(from, from + size - 1);
    if (error) throw new Error(`raw_ingest read failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) out.push(row.payload as CkanRecord);
    if (data.length < size) break;
    from += size;
  }
  return out;
}

async function normalize(ctx: IngestContext): Promise<number> {
  const { db, log } = ctx;
  const now = nowIso();
  const payloads = await readRawPayloads(ctx);
  log(`  normalizing ${payloads.length} staged records…`);

  // Foundation (single row for the whole department).
  const { data: foundation, error: fErr } = await db
    .from("foundations")
    .upsert(
      {
        ...FOUNDATION,
        source: SOURCE,
        source_external_id: "pch",
        last_seen_at: now,
      },
      { onConflict: "name" },
    )
    .select("id")
    .single();
  if (fErr) throw new Error(`foundation upsert failed: ${fErr.message}`);
  const foundationId = foundation.id;

  // Programs → grants (one per distinct prog_name_en).
  const programs = new Map<string, string>(); // slug -> title
  for (const p of payloads) {
    const title = ((p.prog_name_en as string) || "").trim();
    if (!title) continue;
    const slug = programSlug(title);
    if (!programs.has(slug)) programs.set(slug, title);
  }
  const grantRows = [...programs].map(([slug, title]) => ({
    foundation_id: foundationId,
    title,
    eligibility: "both" as const,
    status: "closed" as const,
    source: SOURCE,
    source_external_id: slug,
    last_seen_at: now,
  }));
  for (const batch of chunk(grantRows, 500)) {
    const { error } = await db
      .from("grants")
      .upsert(batch, { onConflict: "source,source_external_id" });
    if (error) throw new Error(`grants upsert failed: ${error.message}`);
  }

  // Map each program slug to its grant id.
  const { data: grantIds, error: gErr } = await db
    .from("grants")
    .select("id, source_external_id")
    .eq("source", SOURCE);
  if (gErr) throw new Error(`grants read failed: ${gErr.message}`);
  const grantBySlug = new Map(
    (grantIds ?? []).map((g) => [
      g.source_external_id as string,
      g.id as string,
    ]),
  );

  // Awards: collapse amendments (same ref_number) to the latest amendment.
  const latest = new Map<string, CkanRecord>();
  for (const p of payloads) {
    const ref = String(p.ref_number ?? "");
    if (!ref) continue;
    const amd = Number(p.amendment_number ?? 0) || 0;
    const cur = latest.get(ref);
    if (!cur || amd >= (Number(cur.amendment_number ?? 0) || 0)) {
      latest.set(ref, p);
    }
  }

  const awardRows: Record<string, unknown>[] = [];
  let skipped = 0;
  for (const [ref, p] of latest) {
    const name = (
      (p.recipient_legal_name as string) ||
      (p.recipient_operating_name as string) ||
      ""
    ).trim();
    const title = ((p.prog_name_en as string) || "").trim();
    const grantId = title ? grantBySlug.get(programSlug(title)) : undefined;
    if (!name || !grantId) {
      skipped++;
      continue;
    }
    awardRows.push({
      grant_id: grantId,
      winner_name: name,
      winner_type: p.recipient_type === "P" ? "individual" : "organization",
      award_date: toDate(p.agreement_start_date),
      award_amount: toNumeric(p.agreement_value),
      notes: (p.agreement_title_en as string) || null,
      source: SOURCE,
      source_external_id: ref,
      last_seen_at: now,
    });
  }

  let upserted = 0;
  for (const batch of chunk(awardRows, 500)) {
    const { error } = await db
      .from("past_awards")
      .upsert(batch, { onConflict: "source,source_external_id" });
    if (error) throw new Error(`past_awards upsert failed: ${error.message}`);
    upserted += batch.length;
  }
  log(
    `  upserted ${programs.size} programs, ${upserted} awards (skipped ${skipped} unattachable)`,
  );

  return programs.size + upserted;
}

export const canadianHeritageAdapter: Adapter = {
  source: SOURCE,
  extract,
  normalize,
};
