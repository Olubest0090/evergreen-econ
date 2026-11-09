-- Evergreen Econ · Phase 3 financial alerts
-- Run once in Supabase SQL Editor

create table if not exists public.econ_financial_alerts (
  id bigserial primary key,
  severity text not null check (severity in ('info', 'warning', 'critical')),
  kind text not null,
  member_id uuid,
  nation_id bigint,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists econ_financial_alerts_created_idx
  on public.econ_financial_alerts (created_at desc);
create index if not exists econ_financial_alerts_kind_idx
  on public.econ_financial_alerts (kind, created_at desc);

alter table public.econ_financial_alerts enable row level security;

-- Optional defaults (owner can change via settings later)
insert into public.econ_settings (key, value, updated_at)
values (
  'financial_security',
  '{"large_withdrawal_money":50000000,"large_adjust_money":25000000,"max_pending_withdrawals_per_member":1}'::jsonb,
  now()
)
on conflict (key) do nothing;

-- Helpful view: members whose ledger sum may not match balance (diagnostic; not a trigger)
-- Run manually if investigating drift:
-- select b.member_id, b.resource, b.balance,
--   coalesce((select sum(l.amount) from econ_ledger l where l.member_id = b.member_id and l.resource = b.resource), 0) as ledger_sum
-- from econ_balances b
-- where abs(b.balance - coalesce((select sum(l.amount) from econ_ledger l where l.member_id = b.member_id and l.resource = b.resource), 0)) > 0.05
-- limit 50;
