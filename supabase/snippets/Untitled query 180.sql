select
  title,
  description,
  award_min,
  award_max,
  status,
  source_external_id,
  raw_source_snapshot
from public.grants order by award_max desc limit 10