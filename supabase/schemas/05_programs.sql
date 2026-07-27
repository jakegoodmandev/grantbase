create table programs (
  id                  uuid primary key default gen_random_uuid(),
  foundation_id       uuid not null references foundations(id) on delete cascade,
  title               text not null,
  description         text,
  -- ingestion/freshness metadata
  source              text,
  source_external_id  text,
  last_seen_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (foundation_id, title),
  unique (source, source_external_id)
);
create index programs_foundation_idx on programs (foundation_id);
create index programs_source_idx     on programs (source, source_external_id);
