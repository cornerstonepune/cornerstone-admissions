# HANDOFF

_Overwritten at the end of every session. Keep under 30 lines. Facts only._

**Updated:** 2026-11-25 · **By:** Plan · **Model:** claude-opus-5-5
**Milestone:** M0 — data model · **Branch:** plan/m0-rls-gaps · **PR:** this PR (ADR 0013, refusal tests, lesson)

## State
- #22 (101 RLS) merged. Its reviewer's 5 gaps are closed in plan, per ADR 0013:
  1. cross-account links → #24 (103) extended: `visits_check_refs`, `lead_activity_check_refs` (lead, stage entry, message).
  2. forged stage history → #25 (104) drops `lead_stage_history_insert`, revokes INSERT; triggers SECURITY DEFINER.
  3. send turned into task → new #30 (107, size:small): lead_activity insert/update/delete policies add `kind = 'call_task'`.
  4. refusal tests → `tests/db/rls-refusals.test.ts` on main (green; red against loosened policies).
  5. `docs/loop/handoff/22.md`: 20 → 19 policies.
- Seeds plan/t24, t25 had main merged in and were re-proven: new tests red on assertions, green with a throwaway
  reference (not committed). plan/t30 pushed: 5 red → 6/6 green with reference. t24/t25/t30 merge cleanly pairwise.
- Hidden `tests/holdout/db/rls.test.ts` is edited on t24 and t25 (different hunks; see ADR 0013 Consequences).

## Next step
Coordinator: build #23, #24, #25, #26, #30 one at a time (shared local Supabase), then #27.
After the last: `loop plan "M0 close: regenerate db/schema.sql"`.

## Blocked / open questions (need Nimish)
- ADR 0013 §3 assumes no person ever edits a follow-up send by hand (server only). Overturn if wrong.
- Dependabot PRs #1–#5: recommended closing all and deleting `.github/dependabot.yml`. Unanswered.
