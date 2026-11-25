# HANDOFF

_Overwritten at the end of every session. Keep under 30 lines. Facts only._

**Updated:** 2026-11-26 · **By:** Plan · **Model:** claude-opus-5-5
**Milestone:** M1 — look and frame (M0 done) · **Branch:** plan/m0-done

## State
- M0 **done**: #56 (111) merged as PR #58; `db/schema.sql` regenerated after 111; `npm run test:db` 23 files / 157 tests pass. PROJECT.md: M0 Done, M1 current (ADR 0018).
- New label `ready` = blockers closed, seed exists, no wireframe gate. Applied to **#52** (hidden routes; seed `plan/t52`, touches `src/admissions/` + middleware only).
- Design ports #7–#12, #18 stay `queued`, unseeded: they change stylesheets/components, so they wait on Nimish approving S-frame. Seed order after approval: #7 → #8, #9 → #10, #18 → #11 → #12.
- `design/approved.json` is still empty.
- Stale PR #49 (`plan/handoff`) still OPEN; superseded. Close it.

## Next step
1. `loop run-ticket 52` → review → merge (ticks G1.2).
2. Close PR #49.
3. After Nimish approves S-frame: plan job to seed #7 (then its dependants).

## Blocked / open questions
- Nimish: approve the S-frame wireframe (and the built-screen snapshots) so the M1 ports can be seeded and built.

## Don't repeat
- Seed hidden tests must also pass against a correct implementation, not only fail on main.
- A BEFORE trigger fires before RLS WITH CHECK: new lead_activity checks go in an AFTER trigger.
- `db/schema.sql` is protected: never list it in a ticket's files; the plan job regenerates it after the merge.
- `/signup?invite=` must never be hidden: invited people sign up there.
- The loop guard hook blocks any Bash command whose text contains the approve command or a frontend file pattern; write such text with the Write tool.

## Files touched this session
- db/schema.sql, PROJECT.md, docs/adr/0018, HANDOFF.md — plan/m0-done. GitHub: label `ready` created, added to #52.
