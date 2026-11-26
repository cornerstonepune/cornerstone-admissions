# HANDOFF

_Overwritten at the end of every session. Keep under 30 lines. Facts only._

**Updated:** 2026-11-26 · **By:** builder (#70 review fixes) · **Model:** claude-opus-5-5
**Milestone:** M6 — Admissions Settings · **Branch:** m6-settings-fixes

## State
- #70 merged (PR #81). This branch fixes its security review: template lookup errors answer 500; a rule's key is every
  field that defines it and follows the rule when edited; non-Latin names get a generated key; impossible dates and a
  reversed campus cut-off are refused; rules and stuck alerts hold a **stage id**, so renaming a stage breaks nothing.
- M3's `stuckAfterByStage` (src/admissions/lib/pipeline.ts) matches the stage id first, then a name for older rows.
- ADR 0025 §2 amended (stage ids, keys); §3 (stage names and welcome words linked out) confirmed by Nimish 2026-11-26.
- New tests: viewer PATCH 403; admin/owner can't forge, change or delete an audit row (tests/db); stuck alert after a
  rename; 500 on lookup error; key, date and Marathi-name cases. No migration.

## Next step
1. Review and merge the fixes PR once CI is green; Nimish clicks through the screen against the wireframe.
2. #69 (engine + S-today) reads rules and stuck alerts by stage id (ADR 0025 §2).

## Blocked / open questions
- Not built: source QR codes and links (format comes with M4), rule Move up/down/Delete.
- Not verified in a browser: no seeded local account was clicked through.
- `tests/holdout/db/invariants-stage-history.test.ts` "leaves a deal that has no lead alone" counts every history row in
  the database, so it fails on the shared local DB while the app has data in it (8 rows); passes on a fresh DB (CI).

## Don't repeat
- In a DB test, one transaction has one now(): pick audit rows by action, not by changed_at order.
- A `route.ts` may export only handlers; shared helpers go in a lib file.
- Settings that name a stage store its id, never its name: names change in Pipeline.
