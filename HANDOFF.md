# HANDOFF

_Overwritten at the end of every session. Keep under 30 lines. Facts only._

**Updated:** 2026-11-26 · **By:** builder (#70) · **Model:** claude-opus-5-5
**Milestone:** M6 — Admissions Settings · **Branch:** m6-settings

## State
- #70 built on `m6-settings` (rebased on main after M3 #80): page `/admissions-settings` (8 tabs + change log) and
  `/api/admissions/settings` (GET any member; POST, PATCH `[id]` owner/admin). No migration.
- Writes go through the caller's RLS client, so migration 105's trigger records who; TypeScript never writes the audit.
- Value shapes, keys and the four upstream tabs: ADR 0025. Stuck alerts = `stuck_<stage>`, `{stage, threshold}` (M3's).
- `/admissions-settings` added to the middleware's protected paths (the existing middleware test demanded it).
- Tests: `src/admissions/lib/settings.test.ts`, `src/app/api/admissions/settings/route.test.ts` (403/400),
  `tests/db/settings-screen.test.ts` (RLS refusal, one audit row per change).

## Next step
1. Review and merge the #70 PR once CI is green; Nimish clicks through the screen against the wireframe.
2. #69 (engine + S-today) reads the rule and alert keys of ADR 0025.

## Blocked / open questions
- Not built: stage renaming and welcome-flow words (link to Pipeline / Flows; upstream tables, so not audited),
  source QR codes and links (format comes with M4), rule Move up/down/Delete.
- Not verified in a browser: no seeded local account was clicked through.

## Don't repeat
- In a DB test, one transaction has one now(): pick audit rows by action, not by changed_at order.
- A `route.ts` may export only handlers; shared helpers go in a lib file.
