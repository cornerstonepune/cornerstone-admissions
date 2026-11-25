# HANDOFF

_Overwritten at the end of every session. Keep under 30 lines. Facts only._

**Updated:** 2026-11-25 23:40 · **By:** Plan · **Model:** claude-opus-5-5
**Milestone:** M0 — data model · **Branch:** plan/m0-seeds-done · **PR:** this PR (ADR 0012, lessons, handoff)

## State
- Seeds pushed (no PRs, by design): plan/t22 (101 RLS) · t23 (102 invite-only) · t24 (103 lead integrity) ·
  t25 (104 stage history) · t26 (105 settings audit, size:small) · t27 (106 current visit). Each proven locally:
  stub → visible+hidden tests red on assertions (not import errors); throwaway reference migration → all DB tests
  green (28/26/27/30/21/24); reference not committed. eslint + typecheck clean on test files.
- #23's stub also turns the `redeem_invitation` guard (`npm test`) red until the builder writes the full body: intended.
- Found: this Supabase grants `authenticated` nothing on new tables/views. ADR 0012: explicit grants, RLS narrows.
  #22's stub and issue now require the grants; #27 needs its view grant and is **blocked by #22**.
- "Don't start yet" comments removed from #22–#27. #24 body updated (AFTER-trigger note). plan/m0-seeds-wip deleted.

## Next step
Coordinator: run #22 first, then #23–#26 in any order, then #27, one at a time (shared local Supabase
`supabase_db_wacrm`). After the last: `loop plan "M0 close: regenerate db/schema.sql"`.

## Blocked / open questions (need Nimish)
- Dependabot PRs #1–#5: recommended closing all and deleting `.github/dependabot.yml`. Unanswered.
- Assumption, open: staff (kakas, didis) = agent, quick-add only.
- New hosted Supabase project at M7: Nimish creates it; cost not checked.
- Open (ADR 0012): all 43 upstream `public` tables lack grants for `authenticated` locally; plan a grants migration
  before any milestone that clicks through upstream screens.

## Don't repeat
- Never open the platform repo (ADR 0003) or touch `ruznbyngtfjsaymuylhm` (ADR 0009). Don't stop other projects' Docker containers.
- A helper's port edit of supabase/config.toml was refused (2026-11-25). Ask Nimish, don't route around it.
- The loop guard blocks Bash naming frontend paths or `design/approved.json`, even read-only.
- `loop plan` runs in the main checkout and switches branches: don't switch branches there while it runs.

## Files touched this session
docs/adr/0012, LESSONS.md, HANDOFF.md; seed branches plan/t22–t27 (migrations 101–106 stubs, tests/db, tests/holdout/db).
