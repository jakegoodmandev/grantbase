create or replace function get_award_insights(
  start_date date default null,
  end_date date default null
)
  returns json
  language sql
  stable
  security definer
  set search_path = public
as $$
  with filtered as (
    select *
    from awards
    where (start_date is null or award_date >= start_date)
      and (end_date is null or award_date <= end_date)
  ),
  overall as (
    select
      count(*) as total_grants,
      count(distinct winner_name) as unique_recipients,
      sum(award_amount) as total_amount,
      avg(award_amount) as average_amount,
      percentile_cont(0.5) within group (order by award_amount) as median_amount,
      min(award_date) as earliest_date,
      max(award_date) as latest_date
    from filtered
  ),
  yearly as (
    select
      extract(year from award_date)::int as year,
      count(*) as grant_count,
      sum(award_amount) as total_amount
    from filtered
    where award_date is not null
    group by 1
    order by 1
  ),
  funders as (
    select
      f.id as id,
      f.name as name,
      sum(a.award_amount) as total_amount
    from filtered a
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
    from filtered a
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
    from filtered a
    group by a.winner_name
    order by total_amount desc
    limit 10
  ),
  amount_buckets as (
    select
      case
        when award_amount < 1000 then '< $1k'
        when award_amount < 10000 then '$1k – $10k'
        when award_amount < 100000 then '$10k – $100k'
        when award_amount < 1000000 then '$100k – $1M'
        when award_amount < 10000000 then '$1M – $10M'
        when award_amount < 100000000 then '$10M – $100M'
        when award_amount < 1000000000 then '$100M – $1B'
        else '≥ $1B'
      end as label,
      case
        when award_amount < 1000 then 'Less than $1,000'
        when award_amount < 10000 then '$1,000 to $10,000'
        when award_amount < 100000 then '$10,000 to $100,000'
        when award_amount < 1000000 then '$100,000 to $1,000,000'
        when award_amount < 10000000 then '$1,000,000 to $10,000,000'
        when award_amount < 100000000 then '$10,000,000 to $100,000,000'
        when award_amount < 1000000000 then '$100,000,000 to $1,000,000,000'
        else '$1,000,000,000 or more'
      end as tooltip,
      min(award_amount) as sort_key,
      count(*) as count
    from filtered
    where award_amount is not null
    group by 1, 2
    order by sort_key
  )
  select json_build_object(
    'overall', (select row_to_json(overall) from overall),
    'yearly', (select coalesce(json_agg(row_to_json(yearly)), '[]'::json) from yearly),
    'funders', (select coalesce(json_agg(row_to_json(funders)), '[]'::json) from funders),
    'programs', (select coalesce(json_agg(row_to_json(programs)), '[]'::json) from programs),
    'recipients', (select coalesce(json_agg(row_to_json(recipients)), '[]'::json) from recipients),
    'amount_buckets', (
      select coalesce(
        json_agg(
          json_build_object('label', label, 'tooltip', tooltip, 'count', count)
          order by sort_key
        ),
        '[]'::json
      )
      from amount_buckets
    )
  );
$$;

grant execute on function get_award_insights(date, date) to anon, authenticated;
