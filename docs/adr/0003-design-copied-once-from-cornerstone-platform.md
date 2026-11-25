# 0003 — Design copied once from the Cornerstone platform (supersedes 0002)

**Date:** 2026-11-25 · **Status:** accepted · **Decided by:** Nimish, in chat, 2026-11-25 ("Copy once")

## Context
ADR 0002 made root `DESIGN.md`, a verbatim copy of Argus's "Uptimo" design doc, the design authority. Its tokens fit, but
its product (a plant-maintenance tool), fonts and wording do not. The Cornerstone platform (`cornerstonepune`'s school
OS) already has a finished design language for the same school: tokens, a Tailwind 4 theme, a design doc and about 40
generic UI components on the same stack (Next 16, React 19, Tailwind 4, shadcn, lucide). Rebuilding them here would
waste weeks and drift from the school's brand. The brief forbade any contact with the platform repo (D3, §4, D10).

## Decision
1. **One copy, read only, done.** On 2026-11-25 the planner read and copied design files from
   `~/cornerstone/cornerstone-platform` at platform commit `dfedfe27c`. This is the only access to the platform repo,
   ever. Nothing in this repo or its loop may open, clone, fetch or reference it again.
2. **What was read:** design files only: `docs/frontend/DESIGN.md`, `docs/frontend/tokens.json`,
   `apps/web/design-system/{tokens.css,PRINCIPLES.md}`, `apps/web/app/globals.css`, `apps/web/components/blocks.css`,
   the logo SVGs in `apps/web/public/brand/`, the source of the generic UI components, and four presentation helpers
   (`lib/icons.tsx`, `utils.ts`, `ux-rules.ts`, `state-scale.ts`). For the domain components (lessons, curriculum,
   children, questions, money, stock) only the file names and import lines were read, to sort them out.
   **Not read:** env files, secrets, migrations, `supabase/`, `db/`, `data/`, specs, business logic, `lib/` modules
   beyond the four above.
3. **Where it lives:**
   - `design/tokens.css`: the platform tokens, now ours (header rewritten, values unchanged).
   - `DESIGN.md` (root): the platform design language rewritten for admissions. It is the design authority.
   - `design/platform/`: the frozen snapshot (the rest of the copy, with `README.md` listing every file, its source path
     and hash). Reference only: excluded from typecheck and lint, never imported by app code, never edited.
     Wireframes may link its `components/blocks.css`. Ported pieces go into
     `src/` through tickets.
   - `design/brand.css`: empty; `.loop.json` `brand_overridable` now names this kit's tokens (`--action*`, `--link`,
     `--font-serif`, `--font-sans`) instead of the global kit's.
4. **No link after the copy:** no runtime import, shared package, submodule, git remote, symlink or dependency on the
   platform. Fixes the platform makes later do not flow here; that is accepted.
5. **Porting is product code.** Each component reaches `src/` through a loop ticket (GitHub issue labelled
   `design-port`), built and reviewed like any other. Inventory: `docs/design/platform-components.md`.
6. **Tickets are queued without seeds.** A port ticket's seed (`plan/t<N>`: skeleton and failing tests) is frontend
   code, and the loop forbids frontend code before a wireframe is approved. So the issues are written now, labelled
   `queued`, and each seed is cut when its milestone's first screen is approved. Assumption recorded because Nimish was
   not asked.

## What this amends in `ADMISSIONS_PROJECT.md`
- **D3** (no shared code with the platform): narrowed. Design files copied once under this ADR are the single
  exception. No other code, repo, deploy, env file or data is shared.
- **§4 isolation**: the no-open/no-reference rule stands, except for the one copy above, which is finished.
- **D10** and **§8**: the design authority is root `DESIGN.md` from the Cornerstone platform, not Argus. Where §8's
  standing rules differ (it says three font types; the platform has two: Source Serif 4 and Source Sans 3), `DESIGN.md`
  wins. §8's "light mode the default" stands: the platform follows the system setting, admissions holds light.

## Consequences
- ADR 0002 is superseded. Argus's `DESIGN.md` is deleted; nothing here referred to Uptimo's names.
- The platform's `DESIGN.md` mentions school concepts (children, subjects, lesson kinds) and its wireframe kit
  (`kit.mjs`, `check.mjs`), which were not copied. Root `DESIGN.md` keeps the rules and drops those; admissions'
  own kinds are named in `GLOSSARY.md` when their screens are drawn.
- Tailwind 4 scans every unignored file for class names, so `design/platform/*.tsx` may add a few unused utilities to
  the CSS bundle until the theme ticket adds `@source not "../../design"`.
- The platform repo is public (its `DESIGN.md` §6 says so), so nothing copied is a secret. A scan of the copy for env
  reads, keys, URLs and emails found none.
