# HANDOFF

_Overwritten at the end of every session. Keep under 30 lines. Facts only._

**Updated:** 2026-11-26 · **By:** Plan · **Model:** claude-opus-5-5
**Milestone:** M1 — look and frame · **Branch:** plan/m1-seeds

## State
- Nimish signed off all 16 wireframes (`loop status`: all APPROVED). This PR commits his sign-off file, as the loop expects the plan PR to.
- **#7 seeded and `ready`**: `plan/t7` (visible `src/admissions/theme.test.ts`, hidden `tests/holdout/theme.test.ts`); 59/59 red on main, 59/59 green against a throwaway reference build. Issue body rewritten: 5 files, budget files<=5 lines<=380 (the theme blocks are ~165 deleted lines), Screens: S-frame.
- **#8 seed pushed, WIP**: `plan/t8` has skeletons (`src/admissions/components/icons.tsx`, `link.tsx`, `src/admissions/lib/ux-rules.ts`) + visible + hidden tests; red proven (143 fail). NOT yet proven green; issue body NOT yet updated; stays `queued`.
- #9, #10, #11, #12, #18: not seeded yet.
- ADR 0019: breakpoint token `--breakpoint-wide`, held light, icon table, hidden UI tests as .ts.

## Next step
1. Coordinator: merge this PR when green; `loop run-ticket 7`.
2. Next plan job: finish #8 (prototype-green check; update issue #8: skeleton list, the icon table from `tests/holdout/icons-ux-rules.test.ts`, Screens: S-frame), then seed #9, #10, #18, #11, #12 in that order. Label each `ready` only once its blockers are closed.

## Blocked / open questions
- Settings › Appearance must be hidden in v1 (ADR 0014 §3) but no ticket covers it; needs one.

## Don't repeat
- Seed hidden tests must also pass against a correct implementation, not only fail on main.
- Hidden tests go in `tests/holdout/*.test.ts` (.ts only: vitest's include skips .tsx there).
- #9 keep-list: the blocks.css classes ported components use (b-tile, b-ritem, b-card-*, b-stat*, b-dpanel*, b-kv, b-count, b-step*, b-timeline/b-tli, b-tabs/b-tab*, b-spark, b-stack, b-meter*); drop data-subject, prow, sq, cgraph, kanban/lane, level*, today-*, peek*, zoom*, capture*.
- A BEFORE trigger fires before RLS WITH CHECK: new lead_activity checks go in an AFTER trigger.
