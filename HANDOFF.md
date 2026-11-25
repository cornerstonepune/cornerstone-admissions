# HANDOFF

_Overwritten at the end of every session. Keep under 30 lines. Facts only._

**Updated:** 2026-11-26 · **By:** Plan · **Model:** claude-opus-5-5
**Milestone:** M0 — data model (closing) · **Branch:** plan/m0-final · **PR:** see below

## State
- #51 (110) merged (PR #55). `db/schema.sql` regenerated for 100–110 in this PR (was stale: still showed pre-110 FK, index, insert policy).
- Reviewer of #55 found two gaps → ADR 0017, ticket **#56** (migration 111): rule-made activity must be the kind its rule makes (send_template→follow_up_send, call_task→call_task, dormant→none); rule_id/stage_history_id fixed on UPDATE; a used rule keeps its action.
- Seed `plan/t56` pushed: 12 red (assertion failures, no import errors), 157/157 green vs a correct 111 (checked locally, not committed). Lint clean on both test files.
- Existing fixtures that recorded sends under `call_task` rules now use `send_template` rules (this PR; 137/137 green on 110).
- Stale PR #49 (`plan/handoff`, mid-merge locally) abandoned; its content is superseded by this handoff. Close it.

## Next step
1. `loop run-ticket 56` → review → merge. 2. Plan job: `npm run db:reset && npm run db:schema`, commit schema.sql (protected: builders can't), tick M0 done in PROJECT.md. 3. `loop run-ticket 52` (M1 hidden routes).

## Blocked / open questions
- Nimish: `loop approve S-frame` (and `loop approve --all`) so M1 ports #7–#12, #18 get seeds.

## Don't repeat
- Seed hidden tests must also pass against a correct implementation, not only fail on main.
- A BEFORE trigger fires before RLS WITH CHECK: new lead_activity checks go in an AFTER trigger (111 does).
- `db/schema.sql` is protected: never list it in a ticket's files; the plan job regenerates it after the merge.
- `/signup?invite=` must never be hidden: invited people sign up there.

## Files touched this session
- db/schema.sql, docs/adr/0017, PROJECT.md, HANDOFF.md, tests/db/{call-tasks-only,invariants-tables}, tests/holdout/db/{call-tasks-only,m0-follow-ups} — plan/m0-final
- plan/t56: supabase/migrations/111 skeleton, tests/db/rule-made-activity, tests/holdout/db/rule-made-activity
