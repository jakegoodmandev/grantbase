# grantbase — Data Ontology

This document defines the real-world concepts in the grantbase catalog and how they
map onto the database schema and the raw data sources. It is based on the actual
shape of the Canadian Heritage (open.canada.ca) data, which is the first source we
ingested.

---

## 1. Core entities

The catalog is a hierarchy of five shared entities:

```text
foundations
  └── programs
        └── grants
              └── awards
                    └── disclosures
```

| Entity | Real-world meaning | User-facing? | Example |
|---|---|---|---|
| `foundations` | A funder / funding body | Yes | Canadian Heritage, Canada Council for the Arts |
| `programs` | A long-lived funding program run by a foundation | Yes | *Canada Arts Presentation Fund* |
| `grants` | A specific funding opportunity / call under a program | Yes | *Canada Arts Presentation Fund — Programming Support* (historical data) or a live call with a deadline (future scraped data) |
| `awards` | A legal agreement / grant award to a recipient | Read-only | $523M Canada-Ontario minority-language education agreement |
| `disclosures` | One raw source transaction / quarterly disclosure | Read-only | A single quarterly row in the Canadian Heritage open-data file |

### Why not collapse `programs` and `grants`?

For the Canadian Heritage historical data, every distinct `prog_name_en` maps to one
program and one grant. But the concepts are different:

- A **program** is a long-lived line of funding (e.g., *Canada Arts Presentation Fund*).
- A **grant** is a specific opportunity or stream under that program (e.g., *Programming Support* vs *Development Support* vs a live open call with an application deadline).

When we scrape live opportunities, the same program will have multiple grants with different deadlines. Keeping the hierarchy future-proofs the schema.

---

## 2. Tenant-private entities

Three tables are private to each signed-in user:

- `applicants` — a person or organization that can apply (`is_self` for the account holder, other rows for managed clients).
- `applications` — an applicant applied to a grant.
- `saved_grants` — a user saved a grant for later.

These are not part of the ingestion ontology; they are part of the application layer.

---

## 3. Canadian Heritage data model

The open.canada.ca *Proactive Disclosure of Grants & Contributions* file (resource
`1d15a62f-5656-49ad-8c88-f40ce689d831`, filtered by `owner_org = "pch"`) contains
one row per **quarterly disclosure transaction**. A single legal agreement can span
multiple disclosures.

### Key source fields

| Source field | Meaning | Maps to |
|---|---|---|
| `owner_org_title` | Funder name | `foundations.name` |
| `prog_name_en` | Program name | `programs.title` / `grants.title` |
| `prog_purpose_en` | Program purpose text | `programs.description` / `grants.description` (preferred) |
| `expected_results_en` | Program-level expected outcomes | `programs.description` / `grants.description` (fallback) |
| `agreement_number` | Identifier for the legal agreement | Part of `awards.source_external_id` |
| `ref_number` | Unique identifier for this quarterly disclosure | `disclosures.source_external_id` |
| `recipient_legal_name` / `recipient_operating_name` | Award recipient | `awards.winner_name` |
| `recipient_type` | "P" = individual, "O" = organization | `awards.winner_type` (always `organization` for `pch`) |
| `agreement_value` | Disclosure amount | `disclosures.amount` / summed into `awards.award_amount` |
| `agreement_start_date` | Agreement / disclosure effective date | `awards.award_date` (earliest in group) |
| `agreement_title_en` | Specific project / agreement title | `awards.notes` (preferred) |

### Critical finding: `agreement_number` is not unique

`agreement_number` is **not** a globally stable identifier. It is reused in two ways:

1. **Across programs.** The same number can appear under different programs.
2. **Across recipients within a program.** The same number can be assigned to different recipients in different fiscal years.

Example: agreement `10337` in the *Athlete Assistance Program* belongs to both Jane
Channell (2023-2024) and Sara Groenewegen (2024-2025). Using `agreement_number` alone
would merge two unrelated athletes.

The correct award key is the composite:

```text
(program_slug, agreement_number, recipient_slug)
```

For small grants with no `agreement_number`, the unique `ref_number` is used instead.

---

## 4. Aggregation rules

### From `disclosures` to `awards`

- Group raw disclosures by the composite award key.
- Pick the **latest** disclosure as the representative (used for `winner_name`, `notes`, etc.).
- Sum all `agreement_value` amounts into `awards.award_amount`.
- Take the **earliest** `agreement_start_date` as `awards.award_date`.

### From `awards` to `grants`

- Compute `award_min` / `award_max` per grant from the min/max non-negative award amounts.
- Negative disclosure amounts are **included in the award sum** (they represent clawbacks/amendments that are part of the real agreement value), but **excluded from the min/max range** so the displayed funding range is not nonsensical.

### From `programs` to `grants`

For the Canadian Heritage historical data, every program maps to exactly one grant.
For future live opportunities, a program will map to many grants (different calls / deadlines).

---

## 5. Cardinality summary

Based on the 2026-07-26 ingestion of the last three fiscal years (2023-04-01 onwards):

```text
foundations: 1
  └─ programs: 92
        └─ grants: 92
              └─ awards: 27,742
                    └─ disclosures: 29,350
```

- Most agreements have exactly one disclosure → `awards` ≈ `disclosures`.
- 1,608 awards have multiple disclosures (multi-year or multi-quarter agreements).
- 2,476 raw source rows were skipped because they lacked a program name or recipient.

### Top 5 by award count

| Program / Grant | Awards | Disclosures | Total awarded |
|---|---:|---:|---:|
| Celebration and Commemoration — Celebrate Canada! | 5,743 | 5,744 | $44,229,148 |
| Building Communities Through Arts and Heritage — Local Arts and Heritage Festivals | 2,688 | 2,690 | $60,164,625 |
| Athlete Assistance Program | 2,523 | 2,540 | $43,245,040 |
| Canada Periodical Fund — CPF - Aid to Publishers | 2,213 | 2,214 | $210,788,185 |
| Canada Periodical Fund — Special Measures for Journalism | 1,851 | 1,851 | $37,230,132 |

---

## 6. Temporal model

`awards.award_date` is the **earliest** `agreement_start_date` for the agreement's
disclosures. That means grouping by year of `award_date` gives the **year the agreement
originated**, not the year the cash was paid out.

Most agreements are disclosed once, so the two views are nearly identical:

| Year (start/disclosure) | Awards | Total awarded / disclosed |
|---|---:|---:|
| 2023 | 8,822 | ~$1.99B |
| 2024 | 8,789 | ~$3.16B |
| 2025 | 7,497 | ~$1.35B |
| 2026 (partial) | 2,634 | ~$248M |

The 2024 spike is driven by the *Development of Official Language Communities Program —
Minority Language Education* grant: $1.53B across 72 provincial/territorial agreements
(mostly Canada-Ontario, Canada-Québec, Canada-New Brunswick, Canada-BC). These are
multi-year agreements spanning 2024-2028.

---

## 7. Open questions / future decisions

1. **Scraped live opportunities.** When we scrape open grant calls, they will land in
   `grants` under existing `programs`. We will need to decide how to map a scraped page
   to a program (likely by name matching) and how to set `status` / `application_deadline`.

2. **Recipient normalization.** `awards.winner_name` is currently denormalized text.
   A future `recipients` table could normalize organizations and individuals, but
   name variations make that non-trivial.

3. **Individual recipients.** The `pch` source never marks `recipient_type = "P"`, so
   all awards resolve to `organization`. Adapter B (Canada Council) is expected to fill
   the individual-artist gap.

4. **Fiscal vs calendar year.** The data is fiscal-year based (April 1 start dates are
   common). We currently expose calendar year from `award_date`. We may want explicit
   fiscal-year fields in the future.

---

## 8. Quick schema reference

```text
foundations:   id, name, description, website, source, source_external_id, last_seen_at
programs:      id, foundation_id, title, description, source, source_external_id, last_seen_at
grants:        id, foundation_id, program_id, title, description, award_min, award_max,
               eligibility, application_deadline, status, source, source_external_id,
               last_seen_at
awards:        id, grant_id, winner_name, winner_type, award_date, award_amount, notes,
               source, source_external_id, last_seen_at
disclosures:   id, award_id, period, amount, payload, source, source_external_id, last_seen_at
```

Every catalog table has:

- `source` — the adapter name (e.g., `canadian-heritage`).
- `source_external_id` — the stable identifier in the source system.
- `last_seen_at` — the last ingestion run that touched the row.
- `created_at` / `updated_at` — row timestamps.

Upserts are keyed on `(source, source_external_id)` for all ingestion-driven tables.
