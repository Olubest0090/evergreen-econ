-- Evergreen Econ · Phase 1 security foundation
-- Run once in Supabase SQL Editor

-- Session revoke support
alter table public.econ_members
  add column if not exists session_epoch integer not null default 0;

-- Structured security events (not the same as request access logs)
create table if not exists public.econ_security_events (
  id bigserial primary key,
  kind text not null,
  ip_address text,
  discord_id text,
  path text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists econ_security_events_created_idx
  on public.econ_security_events (created_at desc);
create index if not exists econ_security_events_kind_idx
  on public.econ_security_events (kind, created_at desc);

-- Login attempts (rate limit + history)
create table if not exists public.econ_login_attempts (
  id bigserial primary key,
  ip_address text,
  discord_id text,
  success boolean not null default false,
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists econ_login_attempts_ip_created_idx
  on public.econ_login_attempts (ip_address, created_at desc);
create index if not exists econ_login_attempts_discord_created_idx
  on public.econ_login_attempts (discord_id, created_at desc);

-- Retention helper: delete access logs older than 90 days (run manually or schedule)
-- delete from public.econ_security_logs where created_at < now() - interval '90 days';
-- delete from public.econ_login_attempts where created_at < now() - interval '90 days';
-- delete from public.econ_security_events where created_at < now() - interval '180 days';

-- RLS: enable on security tables (service role still full access)
alter table public.econ_security_events enable row level security;
alter table public.econ_login_attempts enable row level security;
alter table public.econ_bankrec_credits enable row level security;

-- No policies for anon/authenticated ⇒ deny by default for those roles.
-- Service role bypasses RLS.

-- Optional: prevent anon from reading member balances if table exists
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'econ_balances'
  ) then
    execute 'alter table public.econ_balances enable row level security';
  end if;
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'econ_ledger'
  ) then
    execute 'alter table public.econ_ledger enable row level security';
  end if;
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'econ_members'
  ) then
    execute 'alter table public.econ_members enable row level security';
  end if;
end $$;
