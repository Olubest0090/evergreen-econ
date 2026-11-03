EVERGREEN ECON — PENDING-AWARE BANK SYNC PATCH
==============================================

Repository: Olubest0090/evergreen-econ
Branch: main

WHAT THIS PATCH CHANGES
-----------------------
1. Scheduled bank-deposit sync now calls the existing pending-aware
   lib/bankrecs.ts implementation.
2. Government -> Sync Deposits now calls that same implementation.
3. After a member logs in/registers, the pending-aware sync runs so the
   existing econ_claim_pending RPC can claim deposits for newly registered
   members.
4. The existing bankrecs implementation already:
   - handles main and offshore alliance banks;
   - skips notes containing #ignore;
   - stores unmatched nation deposits in econ_pending_deposits;
   - calls econ_claim_pending;
   - uses bank-record IDs for idempotency.

INSTALL
-------
Replace these three files in your GitHub repository with the matching files
in this ZIP, preserving the folder paths:

  app/api/cron/bank-deposits/route.ts
  app/api/gov/sync-deposits/route.ts
  app/api/auth/callback/route.ts

Do not replace lib/bankrecs.ts; this patch relies on the existing file.

IMPORTANT LIMITATION — LOCUTUS HISTORICAL SHEET IMPORT
-----------------------------------------------------
This patch does NOT yet change Government -> Import. The current importer
matches sheet rows only to registered econ_members, so unmatched nations
will still appear under Unmatched and will not become pending deposits.

I deliberately did not fabricate pending-sheet database rows: the repository
does not contain the SQL definition for econ_pending_deposits or the
econ_claim_pending function. A safe sheet-import patch needs their exact
schema/function definition and must preserve import idempotency without
colliding with real Politics & War bank-record IDs.

BEFORE DEPLOYING
----------------
- Confirm the Supabase database already has econ_pending_deposits and the
  econ_claim_pending() RPC expected by lib/bankrecs.ts.
- Confirm the bankrec_cursor setting is suitable for the cutover. The newer
  sync starts from its own cursor/start timestamp; it does not automatically
  replay the old bankDeposits seen-list history.
- Run one controlled manual sync and inspect its response/errors and the
  Government audit log before relying on scheduled sync.
- Keep a database backup.

This is a source patch only. It does not change your live GitHub repository
or deploy the site.
