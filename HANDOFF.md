# HANDOFF

_Overwritten at the end of every session. Keep under 30 lines. Facts only._

**Updated:** 2026-11-26 · **By:** builder (M6 follow-ups review fixes) · **Model:** claude-opus-5-5
**Milestone:** M6 — follow-ups review fixes · **Branch:** m6-follow-ups-review-fixes

## State
- #87 (Today + follow-ups) merged. This branch is its review fixes (ADR 0028 §8–9), migration 118:
  (a) imported leads (117 `imported_at`): no follow-up from the import's stage entry; untouched only after the parent
  writes post-import; (b) only the latest due day per stage entry fires, a due Dormant rule wins and nothing else is
  sent; (c) 50 follow-ups per run; (d) every stamp's error checked in follow-ups.ts; (e) the template's own language.
- 118 applied to the shared local DB with `supabase migration up` (no reset); db/schema.sql regenerated at 118.
- Tests: tests/db/m6-follow-up-review-fixes.test.ts (a–c), follow-ups-review.test.ts (d, e), today-imported.test.ts.

## Next step
1. CI green → merge. Then schedule the cron (AUTOMATION_CRON_SECRET) so follow-ups send.
2. Nimish clicks through /today against design/wireframes/S-today.html with seeded data.

## Blocked / open questions
- Not built (ADR 0028): call task on a parent's reply, Mine/Everyone, "+ Add a lead", sidebar Today count.
- Template sends carry no variables: a template with {{1}} fails at Meta and is recorded "Not sent".
- /today not clicked through in a browser yet (jsdom render test only).
- `tests/holdout/db/invariants-stage-history.test.ts` "leaves a deal that has no lead alone" counts every history
  row, so it fails on the shared local DB with data in it; passes on a fresh DB (CI).

## Don't repeat
- In a DB test, one transaction has one now(): backdate `lead_stage_history.entered_at` rather than moving stages.
- `claim_due_follow_ups()` claims for every account, 50 at a time: filter its result by your test account, and backdate
  test entries far so they sort first.
