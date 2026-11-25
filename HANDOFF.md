# HANDOFF

_Overwritten at the end of every session. Keep under 30 lines. Facts only._

**Updated:** 2026-11-25 · **By:** Plan · **Model:** claude-opus-5-5
**Milestone:** M0 — data model · **Branch:** plan/lesson-seed-retest

## State
- PR #38 (#26, 105 settings audit) failed loop-tests: the hidden `rls.test.ts` `fill()` inserted a settings_changes row by hand, and 105's trigger wrote a second one.
- Fixed on seed `plan/t26` (56c4d58, pushed): main merged in, manual insert removed, expectations stay at 1. Not fixed on main: main has no 105 trigger, so the same edit there would leave 0 rows and turn main red.
- Proof: on the 105 stub the 2 tests fail (expected for a seed). With PR #38's real 105, `npm run test:db` passes 13 files, 91/91 tests.
- Checked the other seeds: only `rls.test.ts` writes settings_changes by hand. plan/t30 and plan/t36 still have the old copy and pick up the fix when they merge main after #38.
- LESSONS.md: proof lesson (re-prove existing tests when a trigger lands).

## Next step
1. Coordinator: merge `origin/plan/t26` into `t26-m0-105-settings-audit-trail` (PR #38), re-run CI, then review and merge.
2. After #38 merges: merge main into plan/t30 and plan/t36 before their builds.
3. Still open from before: plan/wireframes PR (16 wireframes, ADR 0015) not opened; #36 seed not proven red; #37 has no seed.

## Don't repeat
- When a seed adds a trigger, re-prove every older test that writes to its tables against the real migration.
- Never wrap `loop plan` in a shell `timeout`; run it in the background.
