-- Table-level privileges. RLS decides *which rows* a role may touch, but Postgres
-- still requires the base table privilege to be granted first. Recent Supabase
-- defaults no longer grant these blanket on new public tables, so declare them.

-- Shared catalog: world-readable; writes only via the secret key (service_role).
grant select on foundations  to anon, authenticated;
grant select on programs     to anon, authenticated;
grant select on grants      to anon, authenticated;
grant select on awards       to anon, authenticated;
grant select on disclosures  to anon, authenticated;

grant select, insert, update, delete on foundations  to service_role;
grant select, insert, update, delete on programs     to service_role;
grant select, insert, update, delete on grants      to service_role;
grant select, insert, update, delete on awards       to service_role;
grant select, insert, update, delete on disclosures  to service_role;

-- Tenant-private: only signed-in users act on their own rows (RLS enforces ownership).
grant select, insert, update, delete on applicants   to authenticated, service_role;
grant select, insert, update, delete on applications to authenticated, service_role;
grant select, insert, update, delete on saved_grants to authenticated, service_role;
