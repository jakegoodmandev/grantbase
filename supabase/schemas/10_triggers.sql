create trigger t_foundations_upd  before update on foundations  for each row execute function set_updated_at();
create trigger t_grants_upd       before update on grants       for each row execute function set_updated_at();
create trigger t_applicants_upd   before update on applicants   for each row execute function set_updated_at();
create trigger t_applications_upd before update on applications for each row execute function set_updated_at();
