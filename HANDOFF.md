# HANDOFF

_Overwritten at the end of every session. Keep under 30 lines. Facts only._

**Updated:** 2026-11-25 · **By:** Plan · **Model:** claude-opus-5-5
**Milestone:** M0 — data model · **Branch:** plan/wireframes (pushed, NO PR yet)

## State
- Wireframes: all 16 rendered and looked at. This session fixed: active sidebar glyph unreadable (gen.py; nothing approved yet, so no sign-off voided), stray dot + bare "‹" on S-automations, S-dashboard Team table overflow, S-notifications time not right-aligned, presence-dot key on S-settings-upstream. Guard passes for all 16.
- New issues from PR #34 review: #36 (108: setting in use keeps kind/account), #37 (109: lead move guard covers stage history + probing/guard regression tests). ADR 0015 records both.
- #36 seed `plan/t36` pushed (108 stub + visible + hidden tests) but NOT proven red yet. #37 has no seed.
- design/approved.json untouched.

## Next step
1. Open ONE PR plan/wireframes → main ("Wireframes: all 16 screens; ADR 0015"), `loop ci <pr>`, merge when green.
2. Prove #36 red: apply 108 stub, run `npx vitest run --config vitest.db.config.ts tests/db/invariants-settings-in-use.test.ts tests/holdout/db/invariants-settings-in-use.test.ts`; expect the "rejects"/"counts"/"refuses" cases red, the "lets"/"allows" ones green. Fix the seed if anything errors (e.g. admin can't update settings under RLS).
3. Write #37 seed `plan/t37`: 109 stub (comment only); visible `tests/db/invariants-lead-move.test.ts` (deal move with history only → 23514 red; with visit / with activity → 23514 green); hidden: account move with history, admin via RLS, rpc `deal_matches_lead`/`message_in_account` false for another account's member, anon 42501. A deal move must otherwise be valid (second deal, same contact and account) so the test isn't passing on 103's deal check. Assert the message `/cannot move to another account or deal/`.
4. Then M0 build order: #25, #26, #30, #27, #36, #37; then "M0 close: regenerate db/schema.sql".

## Blocked / open questions
- Upstream: all 43 `public` tables give `authenticated` no read access locally; plan a grants migration before any milestone that clicks through upstream screens.
- Unattended assumptions Nimish can overturn: ADR 0013 §3, ADR 0014, ADR 0015 (a lead's account/deal fixed once it exists).
- Dependabot PRs #1–#5: recommended closing all and deleting `.github/dependabot.yml`. Unanswered.

## Don't repeat
- `.loop/wt/25` existed (builder possibly live): don't `db:reset` the shared container while a build may run; apply a stub with `docker exec -i supabase_db_wacrm psql -U postgres < file` and run only your test files.
- A Bash command containing the sign-off command name is blocked by guard.py. Write such files with the Write tool.
- `.wf-mark` text is bar-coloured (white): outside the bar, put the name in a separate `<b>`.
