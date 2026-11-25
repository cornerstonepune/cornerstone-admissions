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

## Coordinator session 2026-11-26 (appended)
- Merged: #23 (102), #24 (103), #25 (104), #26 (105), PR #44 (all 16 wireframes, still unapproved: Nimish signs each off himself). Follow-up tickets for #24 review findings: #36, #37 (#37 has no seed).
- ESCALATED #30 (107): the builder wrote "## Blocked / - none" and `loop finish` treats the heading as a block (5 attempts failed). Fix with a plan job on the ticket, or rebuild with a handoff that omits the Blocked heading. The migration is in the #30 build folder.
- Lessons: CI runs tests/holdout from main, so seed test fixes land on main first. Builders can't merge; Haiku builders get Bash denied, so drop size:small. Never put orchestrator advice like "git merge" in a ticket's Don't. loop-guard blames a PR for planning commits merged after its Plan-base: refresh seeds from main before building.
- Next: #30, #27 (merge main into plan/t27 first), #36, seed #37, then M0 close: regenerate db/schema.sql.
