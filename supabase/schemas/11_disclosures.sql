create table disclosures (
  id                  uuid primary key default gen_random_uuid(),
  award_id            uuid not null references awards(id) on delete cascade,
  period              text,
  amount              numeric(12,2),
  payload             jsonb not null,
  -- ingestion/freshness metadata
  source              text,
  source_external_id  text,
  last_seen_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (source, source_external_id)
);
create index disclosures_award_idx  on disclosures (award_id);
create index disclosures_source_idx  on disclosures (source, source_external_id);
