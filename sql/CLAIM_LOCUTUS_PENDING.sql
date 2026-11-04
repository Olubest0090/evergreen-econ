-- Run once in Supabase SQL Editor

create table if not exists public.econ_locutus_pending (
  id uuid primary key default gen_random_uuid(),
  nation_id bigint not null,
  nation_label text,
  resource text not null,
  amount numeric not null,
  import_batch text not null,
  mode text default 'match',
  note text,
  created_by text,
  claimed_at timestamptz,
  claimed_member_id uuid,
  created_at timestamptz default now()
);

create unique index if not exists econ_locutus_pending_batch_nation_res
  on public.econ_locutus_pending (import_batch, nation_id, resource);

create index if not exists econ_locutus_pending_nation_unclaimed
  on public.econ_locutus_pending (nation_id)
  where claimed_at is null;

create or replace function public.econ_claim_locutus_pending_for_nation(
  p_nation_id bigint,
  p_member_id uuid
) returns integer
language plpgsql
security definer
as $$
declare
  r record;
  n int := 0;
begin
  if p_nation_id is null or p_nation_id <= 0 or p_member_id is null then
    return 0;
  end if;

  for r in
    select id, resource, amount, note, created_by, import_batch
    from public.econ_locutus_pending
    where nation_id = p_nation_id
      and claimed_at is null
    for update skip locked
  loop
    if r.amount is null or r.amount = 0 then
      update public.econ_locutus_pending
        set claimed_at = now(), claimed_member_id = p_member_id
        where id = r.id;
      continue;
    end if;

    insert into public.econ_ledger (member_id, resource, amount, kind, note, created_by)
    values (
      p_member_id,
      r.resource,
      r.amount,
      'deposit',
      coalesce(r.note, 'Locutus pending claim'),
      coalesce(r.created_by, 'system')
    );

    update public.econ_locutus_pending
      set claimed_at = now(), claimed_member_id = p_member_id
      where id = r.id;

    n := n + 1;
  end loop;

  return n;
end;
$$;

grant execute on function public.econ_claim_locutus_pending_for_nation(bigint, uuid) to service_role;
