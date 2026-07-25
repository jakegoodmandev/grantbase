create table saved_grants (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users(id) on delete cascade,
  grant_id   uuid not null references grants(id)     on delete cascade,
  created_at timestamptz not null default now(),
  unique (owner_id, grant_id)
);
create index saved_grants_owner_idx on saved_grants (owner_id);
