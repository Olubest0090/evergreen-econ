-- Phase 1 grants: tracking, convert negatives, collect on leave
-- Paste in Supabase SQL Editor (no $ dollar-quotes required for table)

create table if not exists public.econ_grants (
  id uuid primary key default gen_random_uuid(),
  member_id uuid,
  nation_id bigint not null,
  leader_name text,
  nation_name text,
  discord_id text,
  grant_type text not null,
  amounts jsonb not null default '{}'::jsonb,
  meta jsonb not null default '{}'::jsonb,
  status text not null default 'active',
  note text,
  issued_at timestamptz not null default now(),
  issued_by text,
  approved_by text,
  collected_at timestamptz,
  collected_by text,
  collected_amounts jsonb,
  collect_note text,
  created_at timestamptz not null default now()
);

create index if not exists econ_grants_nation_idx on public.econ_grants (nation_id);
create index if not exists econ_grants_member_idx on public.econ_grants (member_id);
create index if not exists econ_grants_status_idx on public.econ_grants (status);
create index if not exists econ_grants_type_idx on public.econ_grants (grant_type);

comment on table public.econ_grants is
  'Alliance grants. Active grants are not withdrawable deposits. Collected only when gov chooses (usually on leave).';
