# HANDOFF

_Overwritten at the end of every session. Keep under 30 lines. Facts only._

**Updated:** 2026-11-26 · **By:** Plan · **Model:** claude-opus-5-5
**Milestone:** M1 — look and frame · **Branch:** plan/fix-usage-test-timeout

## State
- This session: flaky `api/ai/usage` truncation test (blocked #63's finish gate) gets a 30s timeout, assertions unchanged; full `npm test` green (1812/1812). Root cause is a perf bug in product code: #73 (`size:small`, `queued`) caches the formatter and removes the timeout.
- Build re-scoped on Nimish's instruction (ADR 0021): one build ticket per milestone (two in M6), wacrm reused first, components ported only inside the screen ticket that needs them.
- Open tickets: #63 (M1 theme follow-ups, seeded, `ready`, unchanged) → #18 (M1 frame; absorbs #8, #9, #12 and hiding Settings › Appearance) → #65 M2 · #66 M3 · #67 M4 · #68 M5 · #69, #70 M6 · #71 M7. All but #63 are `queued`, no seed yet.
- Closed as folded: #8, #9, #12 → #18; #10, #11, #13, #16 → #66; #15 → #69; #14 → #70; #17 → #71.
- CLAUDE.md §4 gains the red-CI rule (non-critical: rerun once, merge with a note; critical: never merged red).
- `plan/t8` (WIP icon map seed) is not built; its table and tests are the starting point for #18's seed.

## Next step
0. #73 can run any time (independent, small).
1. Coordinator: rebase/merge main into #63's build branch so its finish gate picks up this fix; `loop run-ticket 63`.
2. Next plan job: seed #18 (blocked by #63; label `ready` when #63 merges). Then one plan job per milestone to seed its ticket.

## Blocked / open questions
- M2 needs brief §10 items 4–7 from Nimish (Meta test app); M4 needs the cut-off date, grades and welcome wording.

## Don't repeat
- Seed hidden tests must also pass against a correct implementation, not only fail on main.
- Hidden tests go in `tests/holdout/*.test.ts` (.ts only). Under `@vitest-environment jsdom`, read files via `process.cwd()`, not `new URL(…, import.meta.url)`.
- blocks.css: port only the classes the ticket's screen uses (#18: frame + page head).
- A BEFORE trigger fires before RLS WITH CHECK: new lead_activity checks go in an AFTER trigger.
