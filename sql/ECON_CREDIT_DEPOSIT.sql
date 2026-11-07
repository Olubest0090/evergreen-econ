-- Idempotent deposit credit by bankrec id (safe to re-run)
create table if not exists public.econ_bankrec_credits (
  bankrec_id bigint not null,
  member_id uuid not null,
  resource text not null,
  amount numeric not null,
  created_at timestamptz not null default now(),
  primary key (bankrec_id, member_id, resource)
);

create or replace function public.econ_credit_deposit(
  p_member uuid,
  p_resource text,
  p_amount numeric,
  p_bankrec bigint,
  p_note text default null
) returns boolean
language plpgsql
security definer
as $$
begin
  if p_amount is null or p_amount = 0 then
    return false;
  end if;

  insert into public.econ_bankrec_credits (bankrec_id, member_id, resource, amount)
  values (p_bankrec, p_member, p_resource, p_amount)
  on conflict (bankrec_id, member_id, resource) do nothing;

  if not found then
    -- already credited
    return false;
  end if;

  insert into public.econ_ledger (member_id, resource, amount, kind, note, created_by)
  values (
    p_member,
    p_resource,
    p_amount,
    'deposit',
    coalesce(p_note, format('In-game deposit (bank record #%s)', p_bankrec)),
    'system:bankrec'
  );

  return true;
exception
  when unique_violation then
    return false;
end;
$$;

-- Claim pending deposits for nations that registered
create or replace function public.econ_claim_pending()
returns integer
language plpgsql
security definer
as $$
declare
  r record;
  n int := 0;
  mem_id uuid;
begin
  for r in
    select p.*
    from public.econ_pending_deposits p
    where p.claimed_at is null
  loop
    select m.id into mem_id
    from public.econ_members m
    where m.nation_id = r.nation_id and m.status = 'active'
    limit 1;
    if mem_id is null then
      continue;
    end if;
    perform public.econ_credit_deposit(mem_id, r.resource, r.amount, r.bankrec_id, r.note);
    update public.econ_pending_deposits
      set claimed_at = now(), claimed_member_id = mem_id
      where id = r.id;
    n := n + 1;
  end loop;
  return n;
end;
$$;
