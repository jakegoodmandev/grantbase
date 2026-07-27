SET check_function_bodies = false;
CREATE FUNCTION public.get_award_insights()
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with overall as (
    select
      count(*) as total_grants,
      count(distinct winner_name) as unique_recipients,
      sum(award_amount) as total_amount,
      avg(award_amount) as average_amount,
      percentile_cont(0.5) within group (order by award_amount) as median_amount,
      min(award_date) as earliest_date,
      max(award_date) as latest_date
    from awards
  ),
  yearly as (
    select
      extract(year from award_date)::int as year,
      count(*) as grant_count,
      sum(award_amount) as total_amount
    from awards
    where award_date is not null
    group by 1
    order by 1
  ),
  funders as (
    select
      f.id as id,
      f.name as name,
      sum(a.award_amount) as total_amount
    from awards a
    join grants g on a.grant_id = g.id
    join foundations f on g.foundation_id = f.id
    group by f.id, f.name
    order by total_amount desc
    limit 10
  ),
  programs as (
    select
      p.id as id,
      p.title as title,
      sum(a.award_amount) as total_amount
    from awards a
    join grants g on a.grant_id = g.id
    join programs p on g.program_id = p.id
    group by p.id, p.title
    order by total_amount desc
    limit 10
  ),
  recipients as (
    select
      a.winner_name as name,
      sum(a.award_amount) as total_amount,
      count(*) as grant_count
    from awards a
    group by a.winner_name
    order by total_amount desc
    limit 10
  )
  select json_build_object(
    'overall', (select row_to_json(overall) from overall),
    'yearly', (select coalesce(json_agg(row_to_json(yearly)), '[]'::json) from yearly),
    'funders', (select coalesce(json_agg(row_to_json(funders)), '[]'::json) from funders),
    'programs', (select coalesce(json_agg(row_to_json(programs)), '[]'::json) from programs),
    'recipients', (select coalesce(json_agg(row_to_json(recipients)), '[]'::json) from recipients)
  );
$function$;
GRANT ALL ON FUNCTION public.get_award_insights() TO anon;
GRANT ALL ON FUNCTION public.get_award_insights() TO authenticated;
