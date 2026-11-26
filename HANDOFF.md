# HANDOFF

_Overwritten at the end of every session. Keep under 30 lines. Facts only._

**Updated:** 2026-11-26 · **By:** status catch-up (ADR 0032) · **Model:** claude-opus-5-5
**Milestone:** all slices built except M2's hand checks and M7 hosting · **Branch:** docs/status-catch-up

## State
- main at b96c541, CI and Migrations green. No open PRs. Open issues: #65 (M2 hand checks), #73 (small perf bug).
- Built (merged, goals tested): M0, M1 (except G1.3), M3, M4 (except G4.3), M5, M6, M7 report + import. PROJECT.md §5
  now says so goal by goal, naming each test. Nimish has clicked through none of it; nothing checked in a running app.
- G1.3 fails: CI's raw-style rule over all of `src/` finds 228 lines in 71 of 161 screen files (mostly upstream:
  auth, automations, broadcasts, contacts, flows). CI only checks lines a PR adds, so it never caught them.

## Next step
1. Nimish: sign in locally and click through M1–M7; set up the Meta test app and check G2.1–G2.3 (`docs/whatsapp-test-number.md`); time quick-add (G4.3).
2. Decide whether to fix G1.3 (tokenise upstream screens) before go-live, or narrow it to the screens staff use.
3. Go-live (M7): Nimish creates the hosted Supabase project; real number; a proxy that overwrites X-Real-IP;
   the school website's form adds the hidden `website_url` input and a `started_at` value (ADR 0031).

## Blocked / open questions
- From Nimish: grades and cut-off dates per campus, welcome wording, a Cal.com account, office notification on a
  repeat family, staff-only routing.
- `tests/holdout/db/invariants-stage-history.test.ts` "leaves a deal that has no lead alone" counts every history
  row, so it fails on the shared local DB with data in it; passes on a fresh DB (CI).

## Don't repeat
- Update PROJECT.md §5 in the same PR that finishes a milestone; it fell 6 milestones behind (ADR 0032).
- A concurrency test needs committed rows in two sessions: commit, then delete what you made in `finally`.
