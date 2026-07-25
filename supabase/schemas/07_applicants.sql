create table applicants (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references auth.users(id) on delete cascade,
  type         applicant_type not null,
  display_name text not null,
  is_self      boolean not null default false,   -- true = the account holder; false = a managed client
  email        text,
  phone        text,
  bio          text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index applicants_owner_idx on applicants (owner_id);
