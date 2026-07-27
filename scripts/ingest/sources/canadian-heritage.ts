import { type CkanRecord, datastorePages } from "../lib/ckan.js";
import { type Adapter, chunk, type IngestContext } from "../lib/types.js";

// Canadian Heritage (owner_org "pch") slice of the federal Proactive Disclosure
// of Grants & Contributions, via the open.canada.ca CKAN datastore.
//
// Modeling: funder -> program -> grant -> award -> disclosure maps onto
// foundations -> programs -> grants -> awards -> disclosures. Each distinct
// program (prog_name_en) becomes one catalog `programs` row and, for the
// historical data, one `grants` row under it. Each underlying agreement becomes
// an `awards` row; each quarterly source disclosure becomes a `disclosures`
// row linked to its agreement.
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

// The source reuses agreement numbers across programs and, within a program,
// sometimes across different recipients. A real award is the combination of
// program + agreement number + recipient. For small grants with no agreement
// number, fall back to the unique ref_number.
function awardKey(
  programTitle: string,
  agreement: string,
  ref: string,
  recipient: string,
): string {
  if (agreement && recipient && programTitle) {
    return `${programSlug(programTitle)}::${agreement}::${programSlug(recipient)}`;
  }
  return ref;
}

// The source has inconsistent trailing dashes on some program names
// ("Youth Take Charge" vs "Youth Take Charge -"). Normalize those so the same
// program is not stored under two different titles.
function normalizeProgramTitle(name: string): string {
  return name.trim().replace(/\s+-\s*$/, "");
}

// Some source fields contain placeholder text instead of real descriptions.
const DESCRIPTION_PLACEHOLDERS = new Set(["see notes"]);

function isUsefulText(v: unknown): v is string {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length > 0 && !DESCRIPTION_PLACEHOLDERS.has(s.toLowerCase());
}

// The program purpose is the best description, but it is only populated for
// about half of programs. The expected-results text is program-level and
// almost always present, so use it as a fallback.
function bestDescription(p: CkanRecord): string | null {
  if (isUsefulText(p.prog_purpose_en)) return p.prog_purpose_en as string;
  if (isUsefulText(p.expected_results_en))
    return p.expected_results_en as string;
  return null;
}

// Notes are best when they are the specific agreement title, but some small
// grants (e.g., Celebrate Canada!) leave it blank. Fall back to the program's
// expected results so the note column is never empty when the source offers
// meaningful text.
function bestNotes(p: CkanRecord): string | null {
  if (isUsefulText(p.agreement_title_en)) return p.agreement_title_en as string;
  if (isUsefulText(p.expected_results_en))
    return p.expected_results_en as string;
  return null;
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

// The CKAN ref_number embeds the fiscal quarter: "016-YYYY-YYYY-QN-XXXXXX".
function extractPeriod(ref: string): string | null {
  const m = String(ref).match(/^\d+-(\d{4}-\d{4}-Q\d)/);
  return m ? m[1] : null;
}

// ---- Phase 1: extract -> raw_ingest -----------------------------------------
async function extract(ctx: IngestContext): Promise<number> {
  const { db, syncRunId, log } = ctx;
  let landed = 0;
  let reachedOld = false;

  for await (const page of datastorePages({
    resourceId: RESOURCE_ID,
    filters: { owner_org: "pch" },
    // Secondary sort on the unique _id makes offset paging deterministic —
    // without a unique tiebreaker, rows sharing a date can overlap across
    // pages (duplicate reads) or be skipped entirely.
    sort: "agreement_start_date desc, _id asc",
    pageSize: 1000,
  })) {
    const kept: CkanRecord[] = [];
    for (const rec of page) {
      const start = (rec.agreement_start_date as string) || "";
      if (start && start < CUTOFF_START_DATE) {
        reachedOld = true; // sorted desc -> everything after is older too
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

// ---- Phase 2: normalize raw_ingest -> catalog -------------------------------
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
      // a different set each run and the catalog would never converge.
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

type IdRow = { id: string; source_external_id: string };

async function readSourceIds(
  ctx: IngestContext,
  table: "programs" | "grants" | "awards",
): Promise<IdRow[]> {
  const { db } = ctx;
  const out: IdRow[] = [];
  const size = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await db
      .from(table)
      .select("id, source_external_id")
      .eq("source", SOURCE)
      .order("id", { ascending: true })
      .range(from, from + size - 1);
    if (error) throw new Error(`${table} read failed: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...(data as IdRow[]));
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

  // Programs -> grants (one program per distinct prog_name_en; for the
  // historical data we also create one grant per program).
  type ProgramInfo = {
    title: string;
    description: string | null;
    records: CkanRecord[];
  };
  const programs = new Map<string, ProgramInfo>(); // slug -> info
  for (const p of payloads) {
    const title = normalizeProgramTitle((p.prog_name_en as string) || "");
    if (!title) continue;
    const slug = programSlug(title);
    const existing = programs.get(slug);
    if (existing) {
      existing.records.push(p);
      if (!existing.description) {
        const desc = bestDescription(p);
        if (desc) existing.description = desc;
      }
    } else {
      programs.set(slug, {
        title,
        description: bestDescription(p),
        records: [p],
      });
    }
  }

  const programRows = [...programs].map(([slug, { title, description }]) => ({
    foundation_id: foundationId,
    title,
    description,
    source: SOURCE,
    source_external_id: slug,
    last_seen_at: now,
  }));
  for (const batch of chunk(programRows, 500)) {
    const { error } = await db
      .from("programs")
      .upsert(batch, { onConflict: "source,source_external_id" });
    if (error) throw new Error(`programs upsert failed: ${error.message}`);
  }

  // Map each program slug to its id.
  const programIds = await readSourceIds(ctx, "programs");
  const programBySlug = new Map(
    programIds.map((p) => [p.source_external_id, p.id]),
  );

  // Create one grant per program for the historical data.
  const grantRows = [...programs].map(([slug, { title, description }]) => ({
    foundation_id: foundationId,
    program_id: programBySlug.get(slug),
    title,
    description,
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
  const grantIds = await readSourceIds(ctx, "grants");
  const grantBySlug = new Map(
    grantIds.map((g) => [g.source_external_id, g.id]),
  );

  // Awards: one row per underlying agreement. The source publishes quarterly
  // disclosure transactions (each with a unique ref_number), but awards represent
  // an agreement with a recipient. Agreement numbers are NOT globally unique:
  // the same number can be reused across programs or across different recipients
  // in the same program (e.g., Athlete Assistance). The stable key is therefore
  // (program, agreement number, recipient). For small grants with no agreement
  // number, fall back to the unique ref_number.
  type AwardGroup = { records: CkanRecord[]; key: string };
  const groups = new Map<string, AwardGroup>();
  for (const p of payloads) {
    const ref = String(p.ref_number ?? "");
    const agreement = String(p.agreement_number ?? "");
    const programTitle = normalizeProgramTitle(
      (p.prog_name_en as string) || "",
    );
    const recipient = (
      (p.recipient_legal_name as string) ||
      (p.recipient_operating_name as string) ||
      ""
    ).trim();
    const key = awardKey(programTitle, agreement, ref, recipient);
    if (!key) continue;
    const g = groups.get(key);
    if (g) g.records.push(p);
    else groups.set(key, { records: [p], key });
  }

  // Pick the representative record for a group by latest disclosure date.
  const representativeRecord = (records: CkanRecord[]) =>
    records
      .slice()
      .sort((a, b) =>
        String((b.agreement_start_date as string) || "").localeCompare(
          String((a.agreement_start_date as string) || ""),
        ),
      )[0];

  const awardRows: Record<string, unknown>[] = [];
  let skipped = 0;
  for (const { key, records } of groups.values()) {
    const rep = representativeRecord(records);
    const name = (
      (rep.recipient_legal_name as string) ||
      (rep.recipient_operating_name as string) ||
      ""
    ).trim();
    const title = normalizeProgramTitle((rep.prog_name_en as string) || "");
    const grantId = title ? grantBySlug.get(programSlug(title)) : undefined;
    if (!name || !grantId) {
      skipped += records.length;
      continue;
    }
    // Sum the agreement values across the quarterly disclosures so the stored
    // amount reflects the actual award, not a single quarterly transaction.
    const totalAmount = records.reduce((sum, p) => {
      const amt = toNumeric(p.agreement_value);
      return sum + (amt ?? 0);
    }, 0);
    const earliestStart = records
      .map((p) => toDate(p.agreement_start_date))
      .filter((d): d is string => d !== null)
      .sort()[0];
    awardRows.push({
      grant_id: grantId,
      winner_name: name,
      winner_type: rep.recipient_type === "P" ? "individual" : "organization",
      award_date: earliestStart ?? null,
      award_amount: totalAmount === 0 ? null : totalAmount,
      notes: bestNotes(rep),
      source: SOURCE,
      source_external_id: key,
      last_seen_at: now,
    });
  }

  for (const batch of chunk(awardRows, 500)) {
    const { error } = await db
      .from("awards")
      .upsert(batch, { onConflict: "source,source_external_id" });
    if (error) throw new Error(`awards upsert failed: ${error.message}`);
  }

  // Map each award key to its id.
  const awardIds = await readSourceIds(ctx, "awards");
  const awardByKey = new Map(awardIds.map((a) => [a.source_external_id, a.id]));

  // Disclosures: one row per raw source record, linked to its agreement.
  const disclosureRows: Record<string, unknown>[] = [];
  for (const p of payloads) {
    const ref = String(p.ref_number ?? "");
    const agreement = String(p.agreement_number ?? "");
    const programTitle = normalizeProgramTitle(
      (p.prog_name_en as string) || "",
    );
    const recipient = (
      (p.recipient_legal_name as string) ||
      (p.recipient_operating_name as string) ||
      ""
    ).trim();
    const key = awardKey(programTitle, agreement, ref, recipient);
    if (!key) continue;
    const awardId = awardByKey.get(key);
    if (!awardId) continue; // record was part of an unattachable group
    disclosureRows.push({
      award_id: awardId,
      period: extractPeriod(ref),
      amount: toNumeric(p.agreement_value),
      payload: p,
      source: SOURCE,
      source_external_id: String(p._id),
      last_seen_at: now,
    });
  }
  for (const batch of chunk(disclosureRows, 500)) {
    const { error } = await db
      .from("disclosures")
      .upsert(batch, { onConflict: "source,source_external_id" });
    if (error) throw new Error(`disclosures upsert failed: ${error.message}`);
  }

  // Compute award_min / award_max per grant from the actual award amounts.
  // Negative net amounts are extremely rare (only clawbacks on a single
  // disclosure) and make the displayed funding range nonsensical, so exclude
  // them from the min/max calculation.
  const grantAmounts = new Map<string, { min: number; max: number }>();
  for (const row of awardRows) {
    const gid = row.grant_id as string;
    const amt = row.award_amount as number | null;
    if (amt === null || amt < 0) continue;
    const cur = grantAmounts.get(gid);
    if (!cur) {
      grantAmounts.set(gid, { min: amt, max: amt });
    } else {
      if (amt < cur.min) cur.min = amt;
      if (amt > cur.max) cur.max = amt;
    }
  }
  for (const [gid, { min, max }] of grantAmounts) {
    const { error } = await db
      .from("grants")
      .update({ award_min: min, award_max: max })
      .eq("id", gid);
    if (error) throw new Error(`grants amount update failed: ${error.message}`);
  }

  const upserted =
    programRows.length +
    grantRows.length +
    awardRows.length +
    disclosureRows.length;
  log(
    `  upserted ${programRows.length} programs, ${grantRows.length} grants, ${awardRows.length} awards, ${disclosureRows.length} disclosures (skipped ${skipped} raw records unattachable)`,
  );

  return upserted;
}

export const canadianHeritageAdapter: Adapter = {
  source: SOURCE,
  extract,
  normalize,
};
