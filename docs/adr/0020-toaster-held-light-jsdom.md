# 0020 — #7 follow-ups: the toaster is held light by a constant; jsdom for client-render tests

**Date:** 2026-11-26 · **Status:** accepted (Plan, unattended; Nimish not present)

## Context
The PASS review of PR #62 (#7, Cornerstone theme) left four loose ends, now ticket #63: `ThemedToaster` still follows the
saved `wacrm.mode`, so a user who once picked dark gets dark toasts on a light page; globals.css lacks the platform's layer
order line; the viewport advertises `colorScheme: "dark light"`; and tailwind-merge reads the type-scale utilities
(`text-title-page`, `text-body`, …) as text colours, so `cn("text-title-page", "text-primary")` drops the size.

## Decision
1. **The toaster is held light with `theme="light"`**, not by making `useTheme` ignore the saved mode. `useTheme` and
   Settings › Appearance stay as they are; hiding Appearance (ADR 0014 §3) is still its own ticket, and when it lands the
   hook can go too. A constant can't drift from the page; a hook that ignores storage would be a second, hidden rule.
2. **All 8 type-scale names** (`title-page`, `title-section`, `title-small`, `lead`, `body`, `label`, `eyebrow`,
   `caption`) join tailwind-merge's `font-size` group through `extendTailwindMerge` in `src/lib/utils.ts`, not only the
   three the review named: every one of them was being dropped. A hidden test ties the list to globals.css's `@utility text-*`.
3. **`jsdom` (^26) is a devDependency** for tests that must render on the client (`// @vitest-environment jsdom`). The
   toaster bug only shows after hydration; `renderToStaticMarkup` always takes the server branch, so it can't catch it.
   Picked over happy-dom: it is vitest's documented default DOM, the most used, actively released. No testing-library:
   `createRoot` + `act` from React is enough. The default environment stays `node`.
