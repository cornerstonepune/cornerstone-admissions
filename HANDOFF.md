# HANDOFF

_Overwritten at the end of every session. Keep under 30 lines. Facts only._

**Updated:** 2026-11-26 · **By:** Plan · **Model:** claude-opus-5-5
**Milestone:** M0 — data model · **Branch:** plan/rls-fill-audit-dup

## State
- PR #38 (#26, 105) still red: its branch merged main (#39), but #39 carried only the lesson, not the test fix. The fix lives on `origin/plan/t26` and was never merged into #38's branch.
- This PR removes the manual settings_changes insert from `fill()` in `tests/holdout/db/rls.test.ts` (forged-insert 42501 test unchanged).
- Proof (local Supabase): with #38's 105 applied, old test 2 fail / 8 pass, new test 10/10 pass. Without 105 (main today), new test 2 fail (0 rows, expected 1). So this PR is red on main until 105 lands: the two changes must land together.
- loop-guard on #38 flags HANDOFF.md arriving via the main merge commit — false positive, left for Nimish; loop-guard not touched.

## Next step
1. Coordinator: `git merge origin/plan/t26` into `t26-m0-105-settings-audit-trail` (PR #38) and push; re-run CI. That lands test fix + 105 together. Then close this PR as superseded.
2. Nimish: decide on the loop-guard false positive (handoff file brought in by a merge-from-main commit).

## Don't repeat
- A test that depends on a not-yet-merged trigger can't go to main alone; land it on the ticket branch with the migration.
