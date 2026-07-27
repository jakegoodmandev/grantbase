create table awards (
  id                  uuid primary key default gen_random_uuid(),
  grant_id            uuid not null references grants(id) on delete cascade,
  winner_name         text not null,
  winner_type         applicant_type not null,
  award_date          date,
  award_amount        numeric(12,2),
  notes               text,
  -- ingestion/freshness metadata
  source              text,
  source_external_id  text,
  last_seen_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (source, source_external_id)
);
create index awards_grant_idx on awards (grant_id);
