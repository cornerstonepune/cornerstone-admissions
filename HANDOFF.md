# HANDOFF

_Overwritten at the end of every session. Keep under 30 lines. Facts only._

**Updated:** 2026-11-26 · **By:** Plan · **Model:** claude-opus-5-5
**Milestone:** M0 — data model · **Branch:** plan/wireframes

## State
- Main has 102–105 (#23–#26 merged). Seeds plan/t30 and plan/t36 now carry current main (clean merge; hidden `tests/holdout/db/rls.test.ts` identical to main's). Pushed.
- plan/t37 does not exist: issue #37 (109, lead move guard) still has no seed.
- Wireframes: all 16 rendered at 1440 and 500 and looked at. Last 7 (S-frame, S-contacts, S-flows, S-automations, S-dashboard, S-notifications, S-settings-upstream) were correct except the owner shown as a person named "Owner"; now "Anjali D." on S-settings-upstream and S-notifications. This PR lands them on main. No approvals yet; design/approved.json untouched.

## Next step
1. Nimish: review design/wireframes/*.html and approve each screen himself (16).
2. Build #30, #36 from their seeds (#36 seed still not proven red); check #27's seed before its build.
3. Plan: seed for #37 (109) after #36 lands, since 109 builds on 108.

## Don't repeat
- Hidden tests run from main: a test fix that must hold across a pending migration has to work both before and after it.
- When a seed adds a trigger, re-prove every older test that writes to its tables against the real migration.
- Re-merge main into every open seed after a migration lands, or loop-guard's Plan-base goes stale.
