# HANDOFF

_Overwritten at the end of every session. Keep under 30 lines. Facts only._

**Updated:** 2026-11-25 · **By:** Plan · **Model:** claude-opus-5-5
**Milestone:** M0 — repo, harness, runs locally · **Branch:** plan/design-source-platform · **PR:** see below

## State
- Design source switched to the Cornerstone platform (ADR 0003, supersedes 0002). One-time copy done at platform commit `dfedfe27c`: tokens in `design/tokens.css`, root `DESIGN.md` rewritten, frozen snapshot in `design/platform/` (manifest in its README), `brand_overridable` renamed to this kit's tokens.
- Inventory: `docs/design/platform-components.md`. Port tickets #7–#18 (labels `design-port`, `queued`; #9 `size:small`). No seeds yet: they're frontend code, blocked until a screen is approved (ADR 0003 §6).
- `tsconfig.json` and ESLint exclude `design/platform/`. `npm run typecheck` exits 0; `npm run lint` 0 errors / 40 upstream warnings. `npm test` not re-run (no source changed).
- Session stopped at the 150k context budget.

## Next step
Merge this PR when `loop-guard`, `loop-tests` and `CI` are green. Then continue M0: run stock wacrm against local Supabase, check sign-in, then `loop-adopt` (PROJECT.md from ADMISSIONS_PROJECT.md v2.1).

## Blocked / open questions
- M0 checks not yet run: stock wacrm on local Supabase (`supabase start`), a user can sign in.
- Assumption to confirm with Nimish: admissions holds light mode (brief §8), although the platform follows the system setting.

## Don't repeat
- Never open the platform repo again (ADR 0003). Port only from `design/platform/`.
- The loop guard reads every token of a Bash command as a path, including unexpanded `$VARS`, `p="x.css"` and heredoc text. Use literal absolute paths, or write scripts to the scratchpad with the Write tool.
- `gh` default repo is set to `cornerstonepune/cornerstone-admissions`; keep it.

## Files touched this session
- DESIGN.md, design/tokens.css (new), design/brand.css, design/platform/** (new), .loop.json, CLAUDE.md, ADMISSIONS_PROJECT.md, docs/adr/0002 (status), docs/adr/0003 (new), docs/design/platform-components.md (new), tsconfig.json, eslint.config.mjs, HANDOFF.md.
