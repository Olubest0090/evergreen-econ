# Grant repayment integration

## 1. SQL
Run sql/GRANT_REPAY.sql in Supabase.

## 2. cronjob.org
Add (same secret as bank-deposits):
https://evergreen-econ.vercel.app/api/cron/grant-repay?secret=YOUR_CRON_SECRET
Every 5–15 minutes is enough.

## 3. Gov
POST /api/gov/grants { "action": "set_repay_tax", "tax_id": YOUR_50_50_TAX_ID }
POST /api/gov/grants { "action": "migrate_repay" }
POST /api/gov/grants { "action": "run_repay_sync" }  (manual)

## 4. Member home
Wire GrantRepayCard — see patch in app/page snippet below.
