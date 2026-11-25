# 0011 — M0 data model: rules in the database, triggers over a lead function, DB tests in their own run

**Date:** 2026-11-25 · **Status:** accepted (Plan, unattended; assumptions marked)

## Context
ADR 0010 fixed six tables and left names, the "current visit" rule and the per-kind checks to the M0 spec
(`docs/spec/m0-data-model.md`). ADR 0007 asked for one database function behind every lead write. M0 needs a way to
run database tests locally and in CI.

## Decision
1. **Open lead** = `exit` is null and `admitted_at` is null. `leads` carries a copy of the deal's `contact_id` so
   "one open lead per contact" is a partial unique index, the only way Postgres can guarantee it under concurrency.
2. **Triggers instead of a `create_lead` function** (amends ADR 0007): upstream's board updates `deals` directly, so a
   function would be bypassed. Triggers on `deals` and `leads` keep contact, stage history and `deals.status` in step
   whichever path writes.
3. **Current visit counts a no-show** (assumption): latest visit not cancelled or rescheduled, as GLOSSARY says.
   ADR 0010's "booked or visited" would hide a no-show the Today list must chase. Supersedes that phrase of ADR 0010.
4. **Per-kind checks**: follow-up rule and alert values get check constraints now; campus, source and lost reason are
   free objects until M4/M6 need fields.
5. **Delete rules**: a contact or setting in use by a lead can't be deleted (`RESTRICT`); history keeps its stage
   (`RESTRICT` on `pipeline_stages`). Archive with `active = false` instead.
6. **DB tests** run with `npm run test:db` (own Vitest config), not `npm test`, so tickets that don't touch the DB need
   no Postgres. Driver: `postgres` (porsager, Unlicense, no dependencies, types included) over `pg` (needs
   `@types/pg`). CI's `loop-tests` job starts the Supabase CLI's Postgres and runs them. Local ports stay the CLI
   defaults (free on this Mac today; resolves PROJECT §6's ports question without editing `config.toml`).
7. Stage identity (which stage is Admitted, which pipeline is Admissions) is **deferred to M3**.

## Considered
- A `create_lead` / `move_lead` function pair (ADR 0007): bypassed by upstream's board writes. Rejected.
- DB tests inside `npm test`, skipped without a database: a skipped test hides a failure. Rejected.

## Consequences
- Migration 100 replaces upstream's `redeem_invitation` (047's body plus our six tables in its data check); ticket 102
  replaces it again for the no-profile branch. Each replacement starts from the latest body.
- Every lead write fires up to three small triggers; fine at ~2k leads a year.
- M3 must add stage identity (likely an `admissions_settings` kind, with an ADR) before `admitted_at` can be set by a move.
