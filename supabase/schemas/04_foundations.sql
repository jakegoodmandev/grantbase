create table foundations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  description   text,
  website       text,
  contact_email text,
  contact_phone text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
