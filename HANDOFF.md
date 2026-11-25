# HANDOFF

_Overwritten at the end of every session. Keep under 30 lines. Facts only._

**Updated:** 2026-11-25 22:00 · **By:** Plan · **Model:** claude-opus-5-5
**Milestone:** M0 — data model · **Branch:** plan/m0-spec · **PR:** M0 spec (this PR)

## State
- Merged: #6 loop harness, #19 platform design copy, #20 loop-adopt (PROJECT.md, schema, glossary, ADRs 0004–0010).
- This PR: M0 spec `docs/spec/m0-data-model.md`, ADR 0011, migration 100 (six tables, RLS on, no policies), DB test
  harness (`npm run db:reset && npm run test:db`, `tests/db/db.ts`), CI DB job. Local: 13/13 DB tests, 1728/1728 unit
  tests, typecheck clean, lint 0 errors.
- M0 tickets (label M0), one migration each: #22 RLS (101) · #23 invite-only (102) · #24 lead integrity (103) ·
  #25 stage history + deal status (104) · #26 settings audit (105, size:small) · #27 current visit view (106).
  None depends on another. Seeds `plan/t22`–`plan/t27` are pushed from main right after this PR merges.
- G0.1 and G0.6 ticked (CI ran the DB tests on a fresh Supabase).

## Next step
Coordinator: `loop run-ticket` #22–#27 **one at a time** (all share the local Supabase container). After the last
merges: `loop plan "M0 close: regenerate db/schema.sql, tick G0.2–G0.5"` (builders can't touch db/schema.sql).

## Blocked / open questions (need Nimish)
- Dependabot PRs #1–#5: recommended closing all and deleting `.github/dependabot.yml`. Unanswered.
- Assumption, open: staff (kakas, didis) = agent, quick-add only.
- New hosted Supabase project at M7: Nimish creates it; cost not checked.

## Don't repeat
- Never open the platform repo (ADR 0003) or touch `ruznbyngtfjsaymuylhm` (ADR 0009). Don't stop other projects' Docker containers.
- The loop guard blocks Bash naming frontend paths or `design/approved.json`, even read-only.
- `loop plan` runs in the main checkout and switches branches: don't switch branches there while it runs.

## Files touched this session
docs/spec/m0-data-model.md, docs/adr/0011, supabase/migrations/100, db/schema.sql, tests/db/*, vitest*.ts, package.json, CI workflow, PROJECT.md, CLAUDE.md, GLOSSARY.md, HANDOFF.md.
