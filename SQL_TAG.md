-- Optional: run in Supabase for GRANT/IGNORE + tag display
alter table econ_withdrawals add column if not exists tag text;
-- Optional: actor on ledger if missing
-- alter table econ_ledger add column if not exists actor_discord_id text;
