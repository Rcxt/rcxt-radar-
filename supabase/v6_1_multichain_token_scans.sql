-- RCXT Radar V6.1 multichain scan identity.
-- Applied to production Supabase on 2026-09-24 before V6.1 promotion.

alter table public.token_scans
  add column if not exists chain_id text not null default 'solana',
  add column if not exists chain_family text not null default 'solana';

update public.token_scans
set chain_id='solana', chain_family='solana'
where chain_id is null or chain_family is null;

create index if not exists token_scans_chain_address_created_idx
  on public.token_scans (chain_id, token_address, created_at desc);
