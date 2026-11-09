-- Evergreen Econ · Phase 4 IP rules + recovery support
-- Run once in Supabase SQL Editor

create table if not exists public.econ_ip_rules (
  id bigserial primary key,
  ip_address text not null,
  status text not null check (status in ('blocked', 'trusted')),
  reason text,
  created_by text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique (ip_address)
);

create index if not exists econ_ip_rules_status_idx on public.econ_ip_rules (status);
create index if not exists econ_ip_rules_ip_idx on public.econ_ip_rules (ip_address);

alter table public.econ_ip_rules enable row level security;

-- Optional: auto-expire handled in app (expires_at < now() ignored as active block)
