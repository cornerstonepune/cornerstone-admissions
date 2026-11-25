# HANDOFF

_Overwritten at the end of every session. Keep under 30 lines. Facts only._

**Updated:** 2026-11-26 · **By:** Plan · **Model:** claude-opus-5-5
**Milestone:** M0 — data model · **Branch:** plan/rls-fill-audit-either

## State
- CI runs `tests/holdout` from main, so PR #41 (#26, 105 settings audit) stayed red: main's hidden `rls.test.ts` `fill()` inserted a settings_changes row by hand and 105's trigger wrote a second. PR #40 (drop the insert) couldn't pass before 105 exists; closed.
- Fix (this PR): `fill()` inserts the audit row only `where not exists` one for that setting, so it yields exactly 1 row with or without 105.
- Proof (local `npm run db:reset`): main as is → rls.test.ts 10/10. With PR #41's `105_settings_audit.sql` copied in → 10/10. Old main fill() with 105 → 2 failed (the bug, reproduced).

## Next step
1. After this merges: `loop ci 41`, then review and merge #41.
2. After #41 merges: merge main into plan/t30 and plan/t36 before their builds.
3. Still open: plan/wireframes PR (16 wireframes, ADR 0015) not opened; #36 seed not proven red; #37 has no seed.

## Don't repeat
- Hidden tests run from main: a test fix that must hold across a pending migration has to work both before and after it.
- When a seed adds a trigger, re-prove every older test that writes to its tables against the real migration.
