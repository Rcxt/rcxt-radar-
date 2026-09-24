-- RCXT Radar V6.1 calibration independence.
-- Deduplicate repeated auto-refresh scans so calibration sample counts represent
-- independent token/time observations instead of correlated refreshes.

create or replace view public.score_calibration_clean as
with candidates as (
  select
    ts.id as scan_id,
    ts.token_address,
    ts.score_version,
    ts.score,
    ts.setup_score,
    ts.execution_score,
    ts.safety_score,
    ts.data_quality_score,
    ts.signal,
    ts.risk,
    ts.market_state,
    ts.risk_flag_count,
    ts.created_at as scan_created_at,
    so.horizon,
    so.observed_at,
    so.return_pct,
    so.favorable,
    so.delay_minutes,
    coalesce(ts.chain_id,'solana') as chain_id,
    coalesce(ts.chain_family,'solana') as chain_family,
    date_bin(
      case so.horizon
        when '1h' then interval '1 hour'
        when '6h' then interval '6 hours'
        when '24h' then interval '24 hours'
        else interval '1 hour'
      end,
      ts.created_at,
      timestamptz '2000-01-01 00:00:00+00'
    ) as event_bucket,
    row_number() over (
      partition by
        coalesce(ts.chain_id,'solana'),
        ts.token_address,
        ts.score_version,
        so.horizon,
        date_bin(
          case so.horizon
            when '1h' then interval '1 hour'
            when '6h' then interval '6 hours'
            when '24h' then interval '24 hours'
            else interval '1 hour'
          end,
          ts.created_at,
          timestamptz '2000-01-01 00:00:00+00'
        )
      order by abs(coalesce(so.delay_minutes,0)), ts.created_at, ts.id
    ) as sample_rank
  from public.token_scans ts
  join public.score_outcomes so on so.scan_id=ts.id
  where
    ts.score_version is not null
    and ts.score is not null
    and ts.setup_score is not null
    and ts.execution_score is not null
    and ts.safety_score is not null
    and ts.data_quality_score is not null
    and abs(coalesce(so.delay_minutes,0)) <=
      case so.horizon
        when '1h' then 30
        when '6h' then 90
        when '24h' then 180
        else 0
      end
)
select
  scan_id, token_address, score_version, score, setup_score, execution_score,
  safety_score, data_quality_score, signal, risk, market_state, risk_flag_count,
  scan_created_at, horizon, observed_at, return_pct, favorable, delay_minutes,
  chain_id, chain_family, event_bucket
from candidates
where sample_rank=1;

create or replace view public.score_calibration_chain_summary
with (security_invoker=true) as
select
  chain_family, score_version, signal, risk, horizon,
  count(*)::integer as samples,
  count(distinct token_address)::integer as unique_tokens,
  round(avg(return_pct),3) as avg_return_pct,
  round(percentile_cont(0.5) within group (order by return_pct::double precision)::numeric,3) as median_return_pct,
  round(avg(case when favorable is true then 1.0 when favorable is false then 0.0 else null end),4) as directional_hit_rate,
  round(avg(abs(delay_minutes)),2) as avg_abs_delay_minutes
from public.score_calibration_clean
group by chain_family, score_version, signal, risk, horizon;

create or replace view public.score_calibration_chain_buckets
with (security_invoker=true) as
select
  chain_family,
  score_version,
  (floor(coalesce(score::integer,0)::numeric/10.0)*10)::integer as score_bucket_min,
  least(100,((floor(coalesce(score::integer,0)::numeric/10.0)*10)+9)::integer) as score_bucket_max,
  signal, risk, horizon,
  count(*)::integer as samples,
  count(distinct token_address)::integer as unique_tokens,
  round(avg(return_pct),3) as avg_return_pct,
  round(percentile_cont(0.5) within group (order by return_pct::double precision)::numeric,3) as median_return_pct,
  round(avg(case when favorable is true then 1.0 when favorable is false then 0.0 else null end),4) as directional_hit_rate,
  round(avg(abs(delay_minutes)),2) as avg_abs_delay_minutes
from public.score_calibration_clean
group by chain_family, score_version,
  (floor(coalesce(score::integer,0)::numeric/10.0)*10)::integer,
  least(100,((floor(coalesce(score::integer,0)::numeric/10.0)*10)+9)::integer),
  signal, risk, horizon;

alter view public.score_calibration_clean set (security_invoker = true);
