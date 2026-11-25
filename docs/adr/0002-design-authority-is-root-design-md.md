# 0002 — Design authority is root DESIGN.md (from Argus), not the global kit

**Date:** 2026-11-25 · **Status:** superseded by [0003](0003-design-copied-once-from-cornerstone-platform.md)

## Context
Brief D10: `DESIGN.md` in the repo root, copied from Argus, is the only design authority. The loop's init normally copies the global kit (`~/.claude/design`, the Atlas "ivory paper" language) into `design/`. Two design documents would conflict.

## Decision
- Copied `nimishshah1989/argus:docs/DESIGN.md` verbatim to `/DESIGN.md`. Argus has no root DESIGN.md; `docs/DESIGN.md` is its design system.
- The global kit is **not** copied into `design/`. `design/` holds only loop machinery: `brand.css`, `wireframes/`, `approved.json`.

## Consequences
- The copied file is written for "Uptimo" (a plant-maintenance tool): its name, description and font stack (Noto Sans Gujarati) are Argus-specific. Its tokens and rules apply; the product wording needs a light pass by Nimish.
- M1's `cornerstone` theme is built from these tokens in `src/app/globals.css`.
