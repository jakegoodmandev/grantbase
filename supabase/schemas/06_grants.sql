create table grants (
  id                  uuid primary key default gen_random_uuid(),
  foundation_id       uuid not null references foundations(id) on delete cascade,
  program_id          uuid not null references programs(id) on delete cascade,
  title               text not null,
  description         text,
  award_min           numeric(12,2),
  award_max           numeric(12,2),
  eligibility         eligibility_type not null default 'both',
  application_deadline date,
  status              grant_status not null default 'open',
  -- ingestion/freshness metadata
  source              text,
  source_external_id  text,
  last_seen_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint amount_range_valid
    check (award_max is null or award_min is null or award_max >= award_min),
  unique (program_id, title),
  unique (source, source_external_id)
);
create index grants_foundation_idx  on grants (foundation_id);
create index grants_program_idx     on grants (program_id);
create index grants_status_idx      on grants (status);
create index grants_eligibility_idx on grants (eligibility);
create index grants_deadline_idx    on grants (application_deadline);
