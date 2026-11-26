# HANDOFF

_Overwritten at the end of every session. Keep under 30 lines. Facts only._

**Updated:** 2026-11-26 · **By:** builder (M4 review fixes, #91) · **Model:** claude-opus-5-5
**Milestone:** M4 — Entry: one door · **Branch:** m4-review-fixes

## State
- #91 (M4) merged. This branch fixes its security review (ADR 0031 §Review fixes), migration 121 (CREATE OR REPLACE
  `intake_lead`): switched-off sources never set; the website form (`fill = false`) never changes a known family, only
  notes it; a known family's note carries what was submitted (child, DOB, grade, source); a WhatsApp sibling is a
  note, once. Website form: honeypot `website_url` and minimum fill time `started_at` (3 s), both answer the same 201.
  Quick-add saves with no source. QR download URL revoked after a delay.
- 121 is on the shared local DB (psql, one transaction, recorded as version 121; no reset). db/schema.sql = main + 121.
- Tests: tests/db/m4-intake.test.ts (fill, sibling note, inactive source, two concurrent calls on committed rows that
  it deletes afterwards); website and quick-add route tests. The G4.1 note expectation now includes the submitted child.

## Next step
1. CI green → review → merge. The school website's form needs the hidden `website_url` input and a `started_at` value.
2. Production: a proxy that overwrites X-Real-IP in front of the app (the form's rate limit depends on it).

## Blocked / open questions
- Per-grade cut-offs (grade ranges per campus), office notification on a repeat family, staff-only routing: still open.
- `tests/holdout/db/invariants-stage-history.test.ts` "leaves a deal that has no lead alone" counts every history
  row, so it fails on the shared local DB with data in it; passes on a fresh DB (CI).

## Don't repeat
- A module-level `NextResponse` can be sent once only: make a shared response a function.
- A concurrency test needs committed rows in two sessions: commit, then delete what you made in `finally`.
