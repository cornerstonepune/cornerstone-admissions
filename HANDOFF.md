# HANDOFF

_Overwritten at the end of every session. Keep under 30 lines. Facts only._

**Updated:** 2026-11-25 20:10 · **By:** Plan · **Model:** claude-opus-5-5
**Milestone:** M0 — repo, harness, runs locally · **Branch:** plan/loop-init · **PR:** none yet

## State
- Tests: 1728 passing / 0 failing — `npm test` (one timing-flaky test, see LESSONS.md). `npm run typecheck` clean. `npm run lint` 0 errors, 40 upstream warnings.
- Last thing done: loop harness installed on `plan/loop-init` (CLAUDE.md, .loop.json commands, loop CI, ADRs 0001–0002, root DESIGN.md). Branch pushed; session stopped at the 150k context budget.

## Next step
Open the PR for `plan/loop-init` → main (body lists removed: `AGENTS.md`, old `CLAUDE.md`), wait for `loop-guard`, `loop-tests` and `CI` to go green, merge. Then run the printed branch-protection `gh api` call for `cornerstonepune/cornerstone-admissions` (expect refusal: private repo on a free org plan). Then `loop-adopt`: write PROJECT.md from `ADMISSIONS_PROJECT.md` v2.1 plus the code as it is.

## Blocked / open questions
- Root `DESIGN.md` is Argus's "Uptimo" doc copied verbatim. Nimish to confirm it is the right file, or rename the product wording (ADR 0002).
- M0 checks not yet run: stock wacrm against local Supabase (`supabase start`), a user can sign in.

## Don't repeat
- The loop guard blocks any Bash command that names a frontend path (`src/app/**`, `*.css`), even read-only ones. Filter tests by name (`vitest run -t "<name>"`).
- `gh` without `repo set-default` may target upstream wacrm. The default is already set; keep it.

## Files touched this session
- CLAUDE.md, .loop.json, .github/workflows/loop.yml, vitest.config.ts, DESIGN.md, docs/adr/0001–0002, LESSONS.md, HANDOFF.md, ADMISSIONS_PROJECT.md (brief, now tracked); AGENTS.md deleted; init scaffold files added.
