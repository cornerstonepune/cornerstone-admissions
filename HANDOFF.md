# HANDOFF

_Overwritten at the end of every session. Keep under 30 lines. Facts only._

**Updated:** 2026-11-25 23:59 · **By:** Plan · **Model:** claude-opus-5-5
**Milestone:** M0 — data model · **Branch:** plan/m0-rls-gaps · **PR:** #31 (CI green, NOT merged: merge was blocked by the permission classifier)

## State
- Tests: `vitest run --config vitest.db.config.ts tests/db/rls-refusals.test.ts` 2/2 pass on main; 2/2 fail with the 4 policies loosened. Seeds t24/t25/t30: new tests red on assertions, green with a throwaway reference (not committed); t30 6/6.
- Last thing done: PR #31 had the five review gaps of PR #29 closed in plan (ADR 0013): #24 extended (same-account link triggers), #25 extended (trigger-only stage history), new #30 (107, agents write call tasks only, size:small), refusal tests, handoff 22 says 19 policies.

## Next step
1. FIRST, one `loop plan` job: "Draw wireframes for every screen in PROJECT.md §4: the new ones (S-frame, S-lead, S-quick-add, S-today, S-admissions-settings, S-report) as design/wireframes/<ID>.html, and static snapshots for the built ones (S-login, S-join, S-inbox, S-contacts, S-board, S-flows/S-automations, S-dashboard/S-notifications/S-settings-upstream)". One PR. Nimish asked (2026-11-25) for ALL wireframes up front; he signs each off himself in his own terminal.
2. Then M0 build, one ticket at a time (shared local DB): #23, #24, #25, #26, #30, then #27. After the last: `loop plan "M0 close: regenerate db/schema.sql"`. Then M1, M2 in PROJECT.md section 5 order; backend tickets never wait on wireframe sign-off.
3. At context full: write handoff, end `LOOP: CONTEXT FULL`. `loop auto` starts the next session; don't ask Nimish to /clear.

## Blocked / open questions
- Upstream: all 43 `public` tables give `authenticated` no read access locally; plan a grants migration before any milestone that clicks through upstream screens.
- ADR 0013 §3 assumes no person ever edits a follow-up send by hand (server only). Nimish can overturn it.
- Dependabot PRs #1–#5: recommended closing all and deleting `.github/dependabot.yml`. Unanswered.

## Don't repeat
- Builders: Bash only works if the command STARTS with an allowed program (no `( … )`, heredocs, `python3 -`). #22 failed twice on this; add it to each ticket's "Don't" until the plugin's BUILDER_RULES say it.
- Never wrap `loop plan` in a shell `timeout`; run it in the background.
- Seeds branched before 101 merged lack the table grants: merge main into a seed before proving RLS tests (agents get 42501 otherwise).
- 103's BEFORE triggers fire ahead of RLS WITH CHECK; 104's first-stage trigger adds a history row on every lead insert. Tests that insert history by hand or expect 42501 must allow for both (done on t24/t25).
- Local Supabase `authenticated` has no grants on upstream `deals`: test deal moves as superuser with jwt claims set.

## Files touched this session
- docs/adr/0013-rls-same-account-and-server-only-writes.md — the decisions
- tests/db/rls-refusals.test.ts — gap 4 regression tests
- docs/loop/handoff/22.md — 20 → 19 policies
- LESSONS.md — spec lesson
- seeds plan/t24, plan/t25, plan/t30 — stubs and tests (pushed, no PRs)
