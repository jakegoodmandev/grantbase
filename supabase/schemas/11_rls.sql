alter table foundations  enable row level security;
alter table grants       enable row level security;
alter table past_awards  enable row level security;
alter table applicants   enable row level security;
alter table applications enable row level security;
alter table saved_grants enable row level security;

-- Catalog: world-readable, writes only via the secret key (which bypasses RLS)
create policy catalog_read_foundations on foundations for select using (true);
create policy catalog_read_grants      on grants      for select using (true);
create policy catalog_read_awards      on past_awards for select using (true);

-- Tenant data: you only ever touch your own rows
create policy own_applicants on applicants
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy own_applications on applications
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy own_saved on saved_grants
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
