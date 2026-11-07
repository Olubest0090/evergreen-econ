# Bankrec → site deposit fix

## What was wrong
1. Cursor advanced *before* credit succeeded → failed deposits never retried.
2. Nested `alliances { bankrecs }` is less reliable than top-level `bankrecs`.
3. Default cursor start was "now" → skipped the whole 14-day window.
4. `vercel.json` had no cron → auto-sync often never ran.
5. Generic 500s hid the real P&W / Supabase error.

## What we fixed
- Paginated top-level `bankrecs` query
- Cursor only moves after success / intentional skip
- RPC + ledger fallback (idempotent on bankrec id)
- Real error messages in JSON
- Cron every minute on `/api/cron/bank-deposits`

## After deploy
1. Run SQL in Supabase (SQL Editor): `sql/ECON_CREDIT_DEPOSIT.sql`
2. Gov → Bankrecs → Diagnose main (and offshore)
3. If cursor is stuck, set start to 14 days ago with **rescan**
4. Manual sync once; check `last_result` for credited / errors
5. Make a small real deposit and wait ≤1 min
