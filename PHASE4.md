# Phase 4 — IP management & recovery

## Shipped
- econ_ip_rules (blocked / trusted)
- proxy returns 403 for blocked IPs
- Owner UI: IP rules tab + quick-block from failed logins
- Zero all negative balances (recovery ledger rows)
- Revoke sessions by Discord id (API: revoke_sessions)

## SQL
Run sql/PHASE4_IP.sql

## Clear Critical status
1. Financial tab → see 8 negative rows
2. Zero all negative balances (or fix manually)
3. Refresh → status should drop to Healthy/Warning
