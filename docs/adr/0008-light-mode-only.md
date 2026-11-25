# 0008 — Admissions is light mode only

**Date:** 2026-11-25 · **Status:** accepted as an assumption (Plan, unattended; Nimish was not asked)

The brief (§8) says make light mode the default and remove the theme picker; `design/tokens.css` (from the platform,
ADR 0003) follows the system setting. We hold light everywhere: `data-scheme="light"` on `<html>`, no picker, no
`prefers-color-scheme` switch. The dark values stay in `design/tokens.css` so turning dark on later is one ticket, not a
redesign. Wireframes are reviewed in light only. Revisit only if Nimish asks for dark.
