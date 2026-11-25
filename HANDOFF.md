# HANDOFF

_Overwritten at the end of every session. Keep under 30 lines. Facts only._

**Updated:** 2026-11-26 · **By:** Plan · **Model:** claude-opus-5-5
**Milestone:** M0 — data model (closing) · **Branch:** plan/handoff-m0-close · **PR:** #53 merged

## State
- Tests: main `npm run test:db` 120/120, `npm test` exit 0. Seed #51: 13 red, 137/137 green vs a correct 110. Seed #52: 26 red, 1755/1755 green vs a correct impl (both checked locally, not committed).
- Last thing done: PR #53 merged: schema.sql regenerated (100–109), ADR 0016, G0.2–G0.5 ticked. Seeds pushed: `plan/t51` (M0 · 110), `plan/t52` (M1 hidden routes). #7–#12, #18 labelled M1.

## Next step
`loop run-ticket 51` → review → merge; then a plan job runs `npm run db:reset && npm run db:schema`, commits schema, marks M0 done. Then `loop run-ticket 52`.

## Blocked / open questions
- Nimish: `loop approve S-frame` (and `loop approve --all` for built-screen snapshots) so M1 ports #7–#12, #18 get seeds.
- Reviewer's "no rule_id on call tasks" deliberately not applied (GLOSSARY: rules create call tasks); ADR 0016 §1. Nimish can overturn.

## Don't repeat
- Seed hidden tests must also pass against a correct implementation, not only fail on main.
- A BEFORE trigger fires before RLS WITH CHECK: one on lead_activity would turn agents' 42501 into 23514.
- `/signup?invite=` must never be hidden: invited people sign up there.
- Planner `ls src/app` is blocked by the frontend hook; use `git ls-files`.

## Files touched this session
- db/schema.sql, docs/adr/0015 + 0016, PROJECT.md, HANDOFF.md — PR #53
- plan/t51: supabase/migrations/110 skeleton, tests/db + tests/holdout/db follow-up and lead-move tests
- plan/t52: src/admissions/hidden-routes.ts skeleton + test, src/middleware.test.ts, tests/holdout/hidden-routes.test.ts
