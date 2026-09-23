-- RCXT V5.1 notification preferences
-- Server-only table: RLS remains enabled with no anon/authenticated policies.

alter table public.monitor_wallets
  add column if not exists preferences jsonb not null default jsonb_build_object(
    'newBuy', true,
    'rugRisk', true,
    'highRiskBuy', true,
    'hotMomentumBuy', false,
    'signalChanges', true,
    'allSignalChanges', false,
    'scoreCrossing', false,
    'marketCapCrossing', false,
    'radarChanges', false,
    'xMomentum', false,
    'repeatBuyAlerts', false,
    'cooldownMinutes', 20
  );

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'monitor_wallets_preferences_object'
  ) then
    alter table public.monitor_wallets
      add constraint monitor_wallets_preferences_object
      check (jsonb_typeof(preferences) = 'object');
  end if;
end $$;
