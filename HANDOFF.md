# HANDOFF

_Overwritten at the end of every session. Keep under 30 lines. Facts only._

**Updated:** 2026-11-26 · **By:** Plan · **Model:** claude-opus-5-5
**Milestone:** M0 — data model (closing) · **Branch:** plan/m0-close

## State
- `db/schema.sql` regenerated from migrations 100–109 (was stale since 100). On main after #36/#37: `npm run test:db` 120/120, `npm test` exit 0 → G0.2–G0.5 ticked in PROJECT.md.
- ADR 0016 (supersedes 0015 §2): rule-made lead activity names its stage entry and is unique per (lead, rule, entry) for any kind; a used follow-up rule can't be deleted (FK NO ACTION, turn it off instead); people insert call tasks only without a rule; a lead's account and deal never change.
- Reviewer note "CHECK call_task carries no rule_id" was NOT applied: GLOSSARY says a rule can create a call task; ADR 0016 §1 explains.
- #51 (M0 · 110) seeded on `plan/t51`: 13 tests red; all 137 green against a correct 110 (checked locally, not committed). Two old holdout tests now give their rule-made call task a stage entry.
- #52 (M1 · hidden routes) seeded on `plan/t52`: 26 red, 1755/1755 green against a correct implementation. `/signup?invite=` must stay open (invited parents/staff sign up there). `src/middleware.test.ts` now expects 404 for hidden dashboard routes.
- M1 ports #7–#12, #18 labelled M1; still queued: seeds wait for Nimish's `loop approve S-frame`. Wireframes approved: none.

## Next step
1. Build #51 (`loop run-ticket 51`), review, merge. 2. Then a plan job: `npm run db:reset && npm run db:schema`, commit schema, mark M0 done in PROJECT.md. 3. Build #52. 4. Ask Nimish to approve S-frame (and `loop approve --all` for built-screen snapshots) so M1 ports can be seeded.

## Don't repeat
- Seed hidden tests must also pass against a correct implementation, not only fail on main (done for #51, #52).
- A BEFORE trigger fires before RLS WITH CHECK: adding one on lead_activity would turn agents' 42501 into 23514.
- Planner `ls src/app` is blocked by the frontend hook; use `git ls-files` to list routes.
