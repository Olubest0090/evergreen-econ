-- Grant repayment via 50/50 (or configured) tax bracket
-- Run once in Supabase SQL Editor

alter table public.econ_grants
  add column if not exists original_amounts jsonb,
  add column if not exists repaid_amounts jsonb not null default '{}'::jsonb,
  add column if not exists repay_status text not null default 'open';
  -- open | paying | paid

-- Backfill original_amounts from amounts where missing
update public.econ_grants
set original_amounts = amounts
where original_amounts is null and amounts is not null;

-- Mark active grants as open for repayment tracking
update public.econ_grants
set repay_status = 'open'
where status = 'active' and (repay_status is null or repay_status = 'open');

create table if not exists public.econ_grant_tax_credits (
  bankrec_id bigint not null,
  grant_id uuid not null references public.econ_grants(id) on delete cascade,
  amounts jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (bankrec_id, grant_id)
);

create index if not exists econ_grant_tax_credits_grant_idx
  on public.econ_grant_tax_credits (grant_id);

alter table public.econ_grant_tax_credits enable row level security;

-- Settings key (set tax_id in Gov UI):
-- grant_repay: { "tax_id": 12345, "alliance_id": 15590 }
