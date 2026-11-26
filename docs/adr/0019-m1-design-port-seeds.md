# 0019 — M1 design-port seeds: breakpoint, held light, icon table

**Date:** 2026-11-26 · **Status:** accepted (Plan, unattended; Nimish not present)

Nimish signed off S-frame and every wireframe on 2026-11-26, so the design-port tickets (#7–#12, #18) are seeded in the order
#7 → #8, #9 → #10, #18 → #11 → #12. A seed is labelled `ready` only when its blockers are closed. Decisions taken while seeding:

1. **One breakpoint token: `--breakpoint-wide: 43.8125rem` (701 px)** in an `@theme` block of `src/app/globals.css` (#7).
   The platform draws the phone at `max-[700px]` and the desktop at `min-[701px]`, so `wide:` is the desktop and `max-wide:`
   the phone (≤700 px, DESIGN.md §2). rem, not px, so it sorts with Tailwind's own breakpoints. Other platform widths
   (900/1000/1600 px) get a token only when a ticket needs one.
2. **Light is held three ways** (#7): `data-scheme="light"` on `<html>` (tokens.css stops following the system's dark),
   wacrm's `data-theme`/`data-mode` blocks and boot script are deleted, and `DEFAULT_MODE` in `src/lib/themes.ts` becomes
   `"light"` so the toaster matches the page. Settings › Appearance is not touched by #7; hiding it (ADR 0014 §3) needs its own ticket.
3. **The admissions icon table is fixed in the seed** (#8): 55 concepts (sidebar doors, the six state shapes, admissions things,
   actions), each on one named Lucide icon, checked to exist in lucide-react 1.70. The table lives in the hidden test and issue #8;
   school concepts (child, lesson, subject, class, money, stock, acting-as) are not in it; a lead is drawn with `UserRound`.
4. **Hidden UI tests are `.ts`, not `.tsx`**: vitest only collects `tests/**/*.test.ts`, so they render with `createElement` +
   `renderToStaticMarkup`.
