# Phase 2 — Security monitoring

## What shipped
- Owner Security Center UI at `/owner-security` (still 404 for non-owners)
- Tabs: Overview · Login security · Events · Access logs · Admin trail · Emergency
- Live status Healthy / Warning / Critical from env + event signals
- Failed login list, suspicious IPs (24h), cron denied counts
- Emergency lockdown toggles (wired to Phase 1 lockdown flags)

## Prerequisites
Phase 1 SQL must be applied (`econ_security_events`, `econ_login_attempts`).
`OWNER_DISCORD_ID` + login as that Discord user.

## Open
https://evergreen-econ.vercel.app/owner-security
