create table past_awards (
  id           uuid primary key default gen_random_uuid(),
  grant_id     uuid not null references grants(id) on delete cascade,
  winner_name  text not null,
  winner_type  applicant_type not null,
  award_date   date,
  award_amount numeric(12,2),
  notes        text,
  created_at   timestamptz not null default now(),
  -- ingestion/freshness metadata (section 5)
  source              text,
  source_external_id  text,
  last_seen_at        timestamptz,
  unique (source, source_external_id)   -- idempotent upsert key
);
create index past_awards_grant_idx on past_awards (grant_id);
