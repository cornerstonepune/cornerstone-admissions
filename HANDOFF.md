# HANDOFF

_Overwritten at the end of every session. Keep under 30 lines. Facts only._

**Updated:** 2026-11-26 · **By:** Plan · **Model:** claude-opus-5-5
**Milestone:** M0 — data model · **Branch:** plan/rls-fill-audit-either

## State
- Merged this session: #30 (107, PR 46), #27 (106, PR 47). M0 left: #36 (108), #37 (109), then regenerate db/schema.sql (ADR 0011). 16 wireframes merged, awaiting Nimish's own sign-off.
- PR #48 (#36): loop-guard red only on "Ticket PR without a handoff": builder never wrote docs/loop/handoff/36.md. Fix: loop prep 36, loop build 36, loop finish 36.
- #37: seed proven red; 2 builds failed on "Bash permission denied" (builder env, not code); 1 attempt left, then loop build 37 --rescue.
- Stale Plan-base fix: when loop-guard says "must not edit HANDOFF.md", run loop plan to merge main into plan/tN and update the PR body Plan-base.

## Next step
1. #36 handoff fix, #37 rescue, merge both. 2. M0 close: npm run db:schema via plan job. 3. Then M1 tickets.

## Don't repeat
- Seed hidden tests must also pass against a correct implementation, not only fail on main.
- Reviewer notes (plan follow-ups): lead_activity call_task rows can still carry rule_id (add CHECK); rule_id ON DELETE SET NULL clashes with lead_activity_send_has_rule; no test of lead_current_visit as an account member.
