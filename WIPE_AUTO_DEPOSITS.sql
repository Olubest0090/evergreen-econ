-- Wipe auto / bankrec deposit ledger rows (review first)
-- 1) Preview
select id, member_id, resource, amount, kind, note, created_by, created_at
from econ_ledger
where created_by = 'system:bankrec'
   or note ilike '%In-game deposit%'
   or note ilike '%bank deposit%'
   or note ilike '%main bank deposit%'
   or note ilike '%offshore bank deposit%'
order by created_at desc;

-- 2) Delete those rows
delete from econ_ledger
where created_by = 'system:bankrec'
   or note ilike '%In-game deposit%'
   or note ilike '%bank deposit%'
   or note ilike '%main bank deposit%'
   or note ilike '%offshore bank deposit%';

-- 3) Rebuild balances from remaining ledger (if no trigger)
-- Skip if you already have a trigger that keeps econ_balances in sync on delete.
-- Otherwise recalculate:
delete from econ_balances;

insert into econ_balances (member_id, resource, balance)
select member_id, resource, round(sum(amount)::numeric, 2)
from econ_ledger
group by member_id, resource
having abs(sum(amount)) > 0.0001;

-- 4) Reset bankrec "seen" bootstrap so next sync is clean (optional)
-- delete from econ_settings where key like 'bankrec_seen_%';
