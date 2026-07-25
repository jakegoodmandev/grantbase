create table applications (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references auth.users(id) on delete cascade,
  applicant_id uuid not null references applicants(id) on delete cascade,
  grant_id     uuid not null references grants(id)     on delete cascade,
  status       application_status not null default 'draft',
  submitted_at timestamptz,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (applicant_id, grant_id)                       -- one application per applicant per grant
);
create index applications_owner_idx on applications (owner_id);
create index applications_grant_idx on applications (grant_id);
