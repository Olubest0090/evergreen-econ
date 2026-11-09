# Evergreen Econ — Phase 1 Security Foundation

## What shipped

1. **Cron fail-closed** — missing/short `CRON_SECRET` ⇒ 401 (never open)
2. **Security events + login attempts** tables
3. **Login rate limit** — 8 failures / 15 min per IP or Discord id
4. **Session epoch** — logout-all invalidates all cookies for that user
5. **Security headers** on proxy responses
6. **Emergency lockdown** API (owner only) for withdrawals / grants / balances / send / staff / disburse
7. **RLS enabled** on security + balance/ledger/members tables (service role still works)
8. **Gov + Send** respect lockdown flags

## Deploy steps

### 1. Supabase SQL
Run `sql/PHASE1_SECURITY.sql` in SQL Editor.

### 2. Vercel env
- `CRON_SECRET` — random string, **≥ 16 chars** (required)
- `AUTH_SECRET` — already required, ≥ 32 chars
- `OWNER_DISCORD_ID` — your Discord snowflake

### 3. cronjob.org
URL must include secret:
`https://evergreen-econ.vercel.app/api/cron/bank-deposits?secret=YOUR_CRON_SECRET`

### 4. Code
Unzip, commit, push. After deploy, hit cron URL **without** secret → expect 401.
With secret → expect ok JSON.

### 5. Owner lockdown API
GET `/api/owner/security` (must be logged in as owner)
POST `{ "action": "set_lockdown", "flags": { "withdrawals": true } }`
POST `{ "action": "clear_lockdown" }`

### 6. Logout all sessions
POST `/api/auth/logout` body `{ "all": true }` while logged in.

## Not in Phase 1 (later)
Full Security Center UI, IP blocklist UI, device alerts, financial anomaly ML, etc.
