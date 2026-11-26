# HANDOFF

_Overwritten at the end of every session. Keep under 30 lines. Facts only._

**Updated:** 2026-11-26 · **By:** Plan · **Model:** claude-opus-5-5
**Milestone:** M1 — look and frame · **Branch:** plan/t63-notes

## State
- #7 merged (PR #62). Its review's four follow-ups are now **#63, seeded and `ready`** on `plan/t63`: toaster `theme="light"`, platform layer line in globals.css, viewport `colorScheme: "light"`, `extendTailwindMerge` for the 8 type-scale names. 28 tests red on main; 44/44 green against a throwaway reference build (6+/3−). Budget files<=4 lines<=40, Screens: S-frame.
- The seed adds `jsdom` as a devDependency (ADR 0020) for the toaster's client-render test.
- #8 is blocked by #63 (commented on #8): `cn()` drops `text-title-page` etc. until #63 merges.
- #8 seed (`plan/t8`) still WIP as before: red proven, not yet proven green, issue body not updated, `queued`.
- LESSONS.md: seed fix after the build branch merged main → merge main into `plan/t<N>`, set Plan-base to that tip; never cherry-pick.

## Next step
1. Coordinator: merge this PR when green; `loop run-ticket 63`.
2. Next plan job: finish #8 (prove green, issue body), then seed #9, #10, #18, #11, #12. Label `ready` only once blockers close.

## Blocked / open questions
- Settings › Appearance must be hidden in v1 (ADR 0014 §3) but no ticket covers it. After #63 it changes nothing visible (page and toasts held light), so it's a dead control until that ticket exists.

## Don't repeat
- Seed hidden tests must also pass against a correct implementation, not only fail on main.
- Hidden tests go in `tests/holdout/*.test.ts` (.ts only). Under `@vitest-environment jsdom`, read files via `process.cwd()`, not `new URL(…, import.meta.url)` (jsdom's URL breaks readFileSync).
- #9 keep-list: the blocks.css classes ported components use (b-tile, b-ritem, b-card-*, b-stat*, b-dpanel*, b-kv, b-count, b-step*, b-timeline/b-tli, b-tabs/b-tab*, b-spark, b-stack, b-meter*); drop data-subject, prow, sq, cgraph, kanban/lane, level*, today-*, peek*, zoom*, capture*.
- A BEFORE trigger fires before RLS WITH CHECK: new lead_activity checks go in an AFTER trigger.
