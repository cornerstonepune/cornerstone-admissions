# 0018 — M0 done, M1 current; `ready` label for tickets buildable now

**Date:** 2026-11-26 · **Status:** accepted (Plan, unattended; Nimish can overturn)

## Context
The last M0 ticket, #56 (migration 111, ADR 0017), merged as PR #58. M0's goals G0.1–G0.6 were already ticked; the only step left was regenerating `db/schema.sql` (ADR 0011). M1's tickets split into one that touches no screen (#52, hidden routes: `src/admissions/` + middleware) and seven design ports (#7–#12, #18) that change stylesheets and components and so sit behind the wireframe gate.

## Decision
1. `db/schema.sql` regenerated after 111 (`npm run db:reset && npm run db:schema`); `npm run test:db`: 23 files, 157 tests pass. M0 is marked **Done**; M1 is the current milestone.
2. A new GitHub label **`ready`** marks a ticket whose blockers are closed, whose seed branch exists and which needs no approved wireframe. The coordinator builds `ready` tickets first. Today: #52 only.
3. The design ports stay `queued`: they wait on Nimish's approval of the S-frame wireframe, and are seeded after it, in blocker order (#7 → #8, #9 → #10, #18 → #11 → #12).

## Consequences
- Until S-frame is approved, M1 has one buildable ticket; the coordinator should not plan port seeds early (a wireframe edit voids approval and the seed may need to change).
- G1.3 (token check on all `src/`) is checked after the ports land, as PROJECT.md already says.
