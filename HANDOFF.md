# HANDOFF

_Overwritten at the end of every session. Keep under 30 lines. Facts only._

**Updated:** 2026-11-26 · **By:** builder (#67) · **Model:** claude-opus-5-5
**Milestone:** M4 — Entry: one door · **Branch:** m4-one-door

## State
- Built #67 (ADR 0031): migration 119 `intake_lead`; `src/admissions/lib/intake.ts` (phone via M7's `sheetPhone`, date
  of birth, campus by cut-off, source codes); WhatsApp door in the flows engine's dispatch; starter flow "Admissions
  welcome"; `/quick-add` + `POST /api/admissions/intake` (agent+); public `POST /api/admissions/intake/website`
  (env `ADMISSIONS_ACCOUNT_ID`, 5/IP/10 min, body capped while read); Sources tab Copy link + QR (SVG, `qrcode-generator`).
- Tests: G4.1, G4.2, source codes and refusals in `tests/db/m4-intake.test.ts`; parsing and cut-off in
  `src/admissions/lib/intake.test.ts`; form validation and rate limit in `website/route.test.ts`.
- 119 is on the shared local DB (psql, one transaction, recorded as version 119; no reset). db/schema.sql regenerated.

## Next step
1. Nimish: clone "Admissions welcome" in Flows, edit its words, activate it; enter campus cut-offs in Settings.
2. Nimish times quick-add on a phone (G4.3). Set `ADMISSIONS_ACCOUNT_ID` before the website form goes live.

## Blocked / open questions
- One date window per campus can't split a grade range ("Playgroup – Sr KG"): grade is set only for single-grade
  campuses. Per-grade cut-offs need a new campus value shape (ADR) or one campus row per grade.
- Not done: notifying the office when a known family comes again (a note is added); staff limited to quick-add only;
  a sidebar link to quick-add (S-frame approved as is). /quick-add not clicked through in a browser.
- `tests/holdout/db/invariants-stage-history.test.ts` "leaves a deal that has no lead alone" counts every history
  row, so it fails on the shared local DB with data in it; passes on a fresh DB (CI).

## Don't repeat
- The webhook test counts every RPC on its mocked client: new inbound side effects belong behind a collaborator it
  mocks (the flows engine), not inline in the webhook.
- `npm run db:schema` dumps the shared DB: if it holds other branches' migrations, keep only your own objects.
