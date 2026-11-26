# HANDOFF

_Overwritten at the end of every session. Keep under 30 lines. Facts only._

**Updated:** 2026-11-26 · **By:** builder (#69) · **Model:** claude-opus-5-5
**Milestone:** M6 — Today list and follow-ups · **Branch:** m6-today-followups

## State
- Follow-ups (ADR 0027): migration 115 `claim_due_follow_ups()` claims each due follow-up once (invariant 6), reads the
  rules at run time, pauses on a parent's message since the stage entry; Dormant rules close the lead. wacrm's
  automations cron calls `runFollowUps` (src/admissions/lib/follow-ups.ts), which sends via `engineSendTemplate`.
- S-today: `/today` (protected in middleware), `/api/admissions/today`, pure `buildToday` in src/admissions/lib/today.ts.
- Migration 115 applied to the shared local DB with `supabase migration up`; db/schema.sql regenerated.
- Tests: tests/db/m6-follow-ups.test.ts (G6.1–G6.4, call task, Dormant, server-only), today.test.ts, today.test.tsx,
  follow-ups.test.ts, cron route.test.ts (secret).

## Next step
1. CI green → review (migration + cron: security-relevant, ADR 0023) → merge.
2. Nimish clicks through /today against design/wireframes/S-today.html with seeded data.
3. The cron must be scheduled (Vercel Cron / pinger with AUTOMATION_CRON_SECRET) before follow-ups send anywhere.

## Blocked / open questions
- Not built (ADR 0027): call task on a parent's reply, Mine/Everyone, "+ Add a lead", sidebar Today count.
- Template sends carry no variables: a template with {{1}} fails at Meta and is recorded "Not sent".
- Not verified in a browser (no signed-in session for a second dev server); covered by a jsdom render test only.
- `tests/holdout/db/invariants-stage-history.test.ts` "leaves a deal that has no lead alone" still counts every history
  row, so it fails on the shared local DB with data in it; passes on a fresh DB (CI).

## Don't repeat
- In a DB test, one transaction has one now(): backdate `lead_stage_history.entered_at` rather than moving stages.
- `claim_due_follow_ups()` claims for every account: filter its result by your test account.
