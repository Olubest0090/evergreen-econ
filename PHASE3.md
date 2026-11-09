# Phase 3 — Financial protection

## Shipped
- Concurrent withdrawal block (default 1 open DEPOSIT per member)
- Large withdrawal / large balance-adjust → econ_financial_alerts
- Integrity scan (negatives, open withdrawals, ledger orphans)
- Withdrawals honor emergency lockdown
- Security Center → Financial tab

## SQL
Run sql/PHASE3_FINANCIAL.sql once in Supabase.

## Thresholds
econ_settings key financial_security JSON.
