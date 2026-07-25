# Ingestion Pipeline — Reference & Plan

Living reference for grantbase's §5 data ingestion. Covers what's built (Adapter A —
Canadian Heritage), how to run and verify it, the bugs found and why they mattered,
and the plan for the remaining adapters and the scrape/curate frontier.

**Last verified:** 2026-07-24 · **Baseline commit:** `5b961b5` (initial build `6c7be04`)

---

## 0. TL;DR

- The pipeline is **standalone Bun scripts** under `scripts/ingest/`, run with
  `bun run ingest --source=<name>`, writing with the **secret key** (bypasses RLS).
- Two phases per source: **extract** (source → `raw_ingest` staging) and
  **normalize** (`raw_ingest` → catalog `foundations`/`grants`/`past_awards`),
  both idempotent via upserts on stable keys.
- **Adapter A (Canadian Heritage)** is live off the open.canada.ca CKAN datastore
  and loads **1 foundation, 92 programs, 29,350 awards** (recent 3 fiscal years).
  Verified deterministic + idempotent.
- **The Canadian data boundary:** clean feeds give *historical awards*, not *open
  opportunities*. See [`memory/canadian-arts-data-sources.md`] and §5 below.

---

## 1. Context & foundation

**Stack:** Next.js 16 + local Supabase (Postgres) via OrbStack. Local API at
`http://127.0.0.1:55321`, DB at `127.0.0.1:55322` (ports shifted +1000). Secret key
lives in `.env.local` as `SUPABASE_SECRET_KEY` (Bun auto-loads `.env.local`).

**Schema tables** (declarative DDL in `supabase/schemas/`, migrations *generated* by
`supabase db diff` — never hand-written):

| Table | Kind | Role in ingestion |
|---|---|---|
| `foundations` | shared catalog | the funder (Canadian Heritage, Canada Council) |
| `grants` | shared catalog | the program (e.g. "Canada Arts Presentation Fund") |
| `past_awards` | shared catalog | one recipient award |
| `applicants` / `applications` / `saved_grants` | tenant-private | not touched by ingestion |
| `raw_ingest` | ops (server-only) | staging: one row per fetched source item, raw `payload jsonb` |
| `sync_runs` | ops (server-only) | one row per ingestion run (status, counts, errors) |

**Ingestion metadata added in §5** (`supabase/migrations/20260725015347_add_ingestion_metadata.sql`):
- `foundations` + `past_awards` gained `source`, `source_external_id`, `last_seen_at`.
- `past_awards` gained `unique (source, source_external_id)` — its upsert key.
- `grants` already had `source`/`source_external_id`/`last_seen_at` + `unique(source, source_external_id)` from the initial schema.
- `raw_ingest` + `sync_runs` created with **RLS enabled, no public policies**, and
  `grant ... to service_role` only. The secret key (service_role) bypasses RLS; the
  anon/authenticated roles have no DML grant and can't reach these tables via PostgREST.
- `supabase/seed.sql` was emptied — the catalog now comes from ingestion, not mock rows.
  (The original fictional seed is preserved in git history at `6c7be04`.)

**Upsert-key strategy (the idempotency contract):**

| Table | onConflict | External id value |
|---|---|---|
| `raw_ingest` | `source,source_external_id` | CKAN `_id` (unique per datastore row) |
| `foundations` | `name` | (natural key; also stamps `source`/`source_external_id`) |
| `grants` | `source,source_external_id` | `programSlug(prog_name_en)` |
| `past_awards` | `source,source_external_id` | `ref_number` (the disclosure reference) |

Re-running never duplicates — every write is an upsert on one of these keys, and
`last_seen_at` is stamped each pass for future freshness logic.

---

## 2. Pipeline architecture

```
scripts/ingest/
  lib/
    admin-client.ts   adminClient(): service-role SupabaseClient (secret key)
    ckan.ts           datastorePages(): async generator, paginated datastore_search
    types.ts          IngestContext, Adapter, chunk()
  sources/
    canadian-heritage.ts   Adapter A: extract + normalize (both phases in one file)
  run.ts              orchestrator: arg parse, open/close sync_run, run adapter
```

**The Adapter contract** (`lib/types.ts`) — every source implements this:

```ts
type IngestContext = { db: SupabaseClient; syncRunId: string; log: (msg: string) => void };
type Adapter = {
  source: string;
  extract:   (ctx: IngestContext) => Promise<number>; // rows landed in raw_ingest
  normalize: (ctx: IngestContext) => Promise<number>; // catalog rows upserted
};
```

**The orchestrator** (`run.ts`): parses `--source=`, looks the adapter up in the
`ADAPTERS` registry, opens a `sync_runs` row (`status='running'`), runs
`extract` then `normalize`, and closes the run with `success` + counts or `error` +
`error_text`. Add a new source by importing its adapter and adding it to `ADAPTERS`.

**Design decisions worth keeping:**
- **Standalone scripts, not route handlers / Edge Functions.** Ingestion runs outside
  Next's request path; the RLS-bypassing secret key never ships to the browser. It
  only ever loads under `bun run`.
- **Two phases with a raw staging table.** Landing raw payloads untouched means we can
  re-normalize (fix a mapping bug, add a field) without re-fetching from the source.
- **Stable-key upserts everywhere.** No deletes, no truncate-and-reload; re-running
  converges to the correct state.
- **`sync_runs` for observability.** Every run is logged, so a silently-broken adapter
  (0 rows, an error) is visible in one query.

---

## 3. Adapter A — Canadian Heritage (built, verified)

**Source:** the Canadian Heritage slice (`owner_org = "pch"`, 134,212 total records)
of the federal *Proactive Disclosure of Grants & Contributions*, via the
open.canada.ca CKAN datastore. Resource id `1d15a62f-5656-49ad-8c88-f40ce689d831`.

**The mapping** (funder → program → award onto foundations → grants → past_awards):
- One `foundations` row: "Canadian Heritage".
- Each distinct `prog_name_en` → one `grants` row, `status='closed'`,
  `eligibility='both'` (these are historical program instances, not live calls).
- Each disclosure → one `past_awards` row, hung off its program's grant.

**Extract** (`extract()` in `sources/canadian-heritage.ts`):
- Pages `datastorePages({ filters: { owner_org: "pch" }, sort: "agreement_start_date desc, _id asc", pageSize: 1000 })`.
- Keeps rows with `agreement_start_date >= CUTOFF_START_DATE` (`"2023-04-01"`, last 3
  fiscal years); breaks once it crosses the cutoff (sorted desc → the rest are older);
  skips undated rows.
- Upserts each kept record into `raw_ingest` (500/batch), `source_external_id = String(_id)`.

**Normalize** (`normalize()`):
- `readRawPayloads()` reads all staged rows for the source, **ordered by `id`**, paged 1000 at a time.
- Upserts the foundation; builds the distinct-program set → upserts `grants`; re-selects
  to map `programSlug → grant_id`.
- Collapses amendments (same `ref_number`) to the max `amendment_number`, maps each to a
  `past_awards` row, skips any without a program name or recipient, upserts (500/batch).

**Field mapping specifics:**
- `winner_name` ← `recipient_legal_name` (fallback `recipient_operating_name`).
- `winner_type` ← `recipient_type === "P"` ? `individual` : `organization`.
  **Known limitation:** recent `pch` rows carry `recipient_type` as blank or `"O"` (never
  `"P"`), so **all 29,350 awards resolve to `organization`.** That reflects the source
  (Canadian Heritage funds organizations), not a bug. Individual artists come from
  Adapter B, which has an explicit Individual/Organization column.
- `award_amount` ← `agreement_value` (numeric); `award_date` ← `agreement_start_date`
  (ISO, sliced to `YYYY-MM-DD`); `notes` ← `agreement_title_en`.

**Current catalog (deterministic result):** 1 foundation, **92 programs**, **29,350
awards**; `raw_ingest` holds 31,826 staged rows. Top programs by award count:
*Celebration and Commemoration — Celebrate Canada!* (4,885), *Building Communities
Through Arts and Heritage — Local Arts and Heritage Festivals* (1,466), *Canada Arts
Presentation Fund — Programming Support* (1,072), *Canada Periodical Fund* (883),
*Development of Official Language Communities* (837).

**Determinism target:** distinct `ref_number` in `raw_ingest` = 31,826 = row count, i.e.
**no amendments** in the recent window. Of those, **29,350** have both a program name and
a recipient (attachable); the other 2,476 are skipped. Repeated runs converge to exactly
29,350 awards / 92 programs.

---

## 4. Bugs found (and why they generalize)

Both were pagination-over-unstable-order bugs. Any future adapter that pages a large
result set is exposed to the same class, so they're worth internalizing.

**Bug 1 — extract: offset paging over a non-unique sort key.**
Sorting only by `agreement_start_date desc` and paging by `offset` meant rows sharing a
date could shift between requests → pages **overlapped and skipped**. The first working
run silently **missed ~5,600 rows** (raw_ingest 26,229 instead of 31,826). Not a crash —
a silent under-count.
*Fix:* add a unique tiebreaker → `sort: "agreement_start_date desc, _id asc"`. Offset
paging is only correct when the ORDER BY is a total order.

**Bug 2 — normalize: `.range()` with no `ORDER BY`.**
`readRawPayloads()` paged `raw_ingest` with `.range(from, from+size-1)` and **no
`.order()`**. PostgREST range without an order returns an arbitrary, overlapping subset,
so each run processed a *different* set of `ref_number`s and `past_awards` **never
converged** — it grew run-over-run (27,099 → 28,351 → …) as each pass inserted
previously-unseen rows. Worse than Bug 1: non-determinism, not just under-count.
*Fix:* `.order("id", { ascending: true })` before `.range()`.

**Takeaway for future adapters:** never paginate (source API *or* Postgres reads) without
a total-order sort. Prefer a unique column (or append one) as the final sort key. Verify
by running twice and asserting identical counts.

---

## 5. How to run & verify

**Prereqs:** OrbStack running; local Supabase up (`bunx supabase status`); `.env.local`
has `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SECRET_KEY`.

**Run:**
```bash
bun run ingest --source=canadian-heritage
```
Expect (~60–90s): a `sync_run` id, `landed N records…` progress, then
`upserted 92 programs, 29350 awards (skipped 2476 unattachable)` and
`✓ done: 31826 fetched, 29442 catalog rows upserted`.

**Verify counts + spot-check:**
```bash
docker exec supabase_db_grantbase psql -U postgres -c "
select 'foundations' t, count(*) from foundations
union all select 'grants', count(*) from grants
union all select 'past_awards', count(*) from past_awards
union all select 'raw_ingest', count(*) from raw_ingest;"

docker exec supabase_db_grantbase psql -U postgres -c "
select g.title, count(pa.id) awards from grants g
join past_awards pa on pa.grant_id = g.id
group by g.title order by awards desc limit 5;"
```

**Verify idempotency + convergence** (run twice, counts must be identical):
```bash
bun run ingest --source=canadian-heritage   # run 1
bun run ingest --source=canadian-heritage   # run 2 — same counts
# Independent target from staged data:
docker exec supabase_db_grantbase psql -U postgres -t -c "
select count(distinct payload->>'ref_number') from raw_ingest
where coalesce(payload->>'prog_name_en','')<>''
  and coalesce(payload->>'recipient_legal_name', payload->>'recipient_operating_name','')<>'';"
# → 29350, must equal past_awards row count
```

**Clean reload** (clears catalog, keeps raw_ingest):
`docker exec supabase_db_grantbase psql -U postgres -c "truncate foundations cascade;"`
then re-run. A full `bunx supabase db reset` rebuilds schema + empty seed (then re-ingest).

**Gotchas / assumptions baked in:**
- CKAN full-text `q`, `datastore_search_sql`, and `distinct=true` are **disabled** on this
  >100k-row resource. Only exact-match `filters=` + offset paging + `sort` work.
- "Recent" = hard-coded `CUTOFF_START_DATE = "2023-04-01"`. Change the const to widen.
- The whole recent window is loaded into memory during normalize (~31.8k objects) — fine
  here; revisit if a source is much larger.
- `grants.title` is globally `unique`; program names are distinct within `pch`. A future
  cross-source title collision would need disambiguation (e.g. funder-prefixed titles).

---

## 6. Plan — remaining adapters

### Adapter B — Canada Council for the Arts (next)
- **Source shape:** a **CSV file download** (not an API). Canada Council is a Crown
  corporation and is *not* in the federal `pch` file.
- **URL:** `https://canadacouncil.ca/-/media/Files/CCA/Research/stats-and-stories/data-tables/2024-25/en/Open-Data-2017-2025.csv`
  — ~32 MB, **65,002 rows (2017–2025)**. **The path embeds the fiscal year and changes
  annually**, so the adapter must resolve the current link from
  `https://canadacouncil.ca/research/data-tables` rather than hardcode it.
- **What it adds:** an explicit **Recipient Type (Individual/Organization)** column — so
  it surfaces **individual artists**, which the `pch` data cannot. Plus **Field of
  Practice** (Media Arts, Literature, Visual Arts, Music, Theatre, Dance…).
- **New wrinkle:** the CSV has **no native stable id**, so `source_external_id` must be a
  deterministic hash of (year, recipient, program code, amount, approval date).
- **Reuses:** the entire `Adapter`/`IngestContext` contract, `run.ts` orchestration,
  `chunk()`, upsert-key strategy, and the funder→program→award mapping.
- **Differs:** extract fetches + parses a CSV instead of paging JSON; needs a CSV parser
  and the synthesized-id logic; `winner_type` comes straight from the column.

### Later adapters (provincial/municipal)
Ontario Arts Council, CALQ (Québec), BC Arts Council, Toronto Arts Council, etc. Each
publishes recipient lists; most are per-funder files or HTML tables. They validate that
the multi-adapter design scales past two sources. Not yet scoped.

**What the multi-adapter approach should prove:** that a new source is *only* an
extract + a field mapping — the staging table, upsert contract, orchestration, and
verification recipe are all shared. Adapter B is the first real test (file vs API).

---

## 7. The separate frontier — open opportunities (scrape/curate)

Everything above populates **`past_awards`** (historical recipients) and derives
`foundations`/`grants`-as-programs. **None of it produces open, applyable
opportunities** — the `grants` "apply now" rows with live `application_deadline` and
`status='open'` that are the app's core user value.

**There is no API for open opportunities in Canada.** They live only as HTML on each
funder's program pages (e.g. `canadacouncil.ca/funding`). This is a distinct track:
scrape structured program pages and/or a human-curated queue, landing into the same
`grants` table with `status='open'`, `source_external_id` = the program page id, and real
deadlines. It shares the `raw_ingest`/upsert plumbing but needs its own extractors and a
freshness job (flip to `closed` when `application_deadline < current_date`). Tackle after
the award-history adapters are proven.

---

## 8. Open questions / decisions

- **Build Adapter B next, or QA Adapter A in the UI first?** The ingested data has only
  been verified via SQL. A UI pass (browse `/grants`, open a program, see real past
  winners) would confirm the read path renders 92 closed grants + winners correctly.
  Per the saved preference, UI QA needs **Chrome connected** (not `/browse`). *Undecided.*
- **Arts filtering for `pch`.** Current choice (user-directed) is **all `pch` programs**,
  not an arts-only allowlist — so sport/official-languages programs are included. An
  arts-only allowlist could be added later as a program-name filter in extract.
- **`recipient_type` is uninformative for `pch`** (all organization). Fine for now;
  Adapter B fills the individual-artist gap.
- **Amount edge cases.** `numeric(12,2)` caps at ~10 billion; no `pch` value approaches it.
  Negative amendment adjustments are possible but absent in the recent no-amendment window.

---

## 9. Quick reference

| Thing | Value |
|---|---|
| Run command | `bun run ingest --source=canadian-heritage` |
| CKAN resource id | `1d15a62f-5656-49ad-8c88-f40ce689d831` |
| pch filter | `filters={"owner_org":"pch"}` (134,212 total) |
| Stable sort | `agreement_start_date desc, _id asc` |
| Cutoff | `2023-04-01` (last 3 FY) |
| Result | 1 foundation, 92 programs, 29,350 awards |
| CCA CSV | `…/data-tables/2024-25/en/Open-Data-2017-2025.csv` (65,002 rows) |
| Baseline commit | `5b961b5` |
| Data-source memory | `memory/canadian-arts-data-sources.md` |
