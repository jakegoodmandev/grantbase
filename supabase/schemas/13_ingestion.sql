-- Ingestion staging + observability (section 5).
-- Server-only: written with the secret key (service_role); never exposed to
-- anon/authenticated. sync_runs is defined first so raw_ingest can FK to it.

create table sync_runs (
  id             uuid primary key default gen_random_uuid(),
  source         text not null,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  status         text not null default 'running',   -- running | success | error
  items_fetched  integer not null default 0,
  items_upserted integer not null default 0,
  error_text     text
);
create index sync_runs_source_idx on sync_runs (source, started_at desc);

-- Land raw source records untouched so we can re-normalize without re-fetching.
create table raw_ingest (
  id                 uuid primary key default gen_random_uuid(),
  source             text not null,
  source_external_id text not null,
  payload            jsonb not null,
  sync_run_id        uuid references sync_runs(id) on delete set null,
  fetched_at         timestamptz not null default now(),
  unique (source, source_external_id)
);
create index raw_ingest_source_idx on raw_ingest (source);

-- RLS: server-only tables. Enable (default-deny) with no public policies, and
-- grant privileges only to service_role (the secret key, which bypasses RLS).
alter table sync_runs  enable row level security;
alter table raw_ingest enable row level security;

grant select, insert, update, delete on sync_runs  to service_role;
grant select, insert, update, delete on raw_ingest to service_role;
