# 0031 — One door: intake_lead behind WhatsApp, quick-add and the website form; source codes on WhatsApp links

**Date:** 2026-11-26 · **Status:** accepted (builder, #67; assumptions open to Nimish)

## Context
M4: every enquiry becomes one lead with its source (G4.1), routed to a campus by date of birth at the cut-off (G4.2),
from three doors. Campus settings already hold `grades`, `born_from`, `born_before` (ADR 0025 §2). wacrm already has the
webhook, contacts, flows (`collect_input` stores answers in `flow_runs.vars`) and M7 already normalises phones.

## Decision
- **Migration 119, `intake_lead(account, lead jsonb)`**, run as the caller (quick-add through RLS as the staff member;
  WhatsApp and the website form as service_role, whose rows get the account owner as author, as wacrm's webhook does):
  find-or-create the contact by normalised phone (or take the contact the webhook found), reuse its open lead or open
  one in the Admissions pipeline's first stage. Races land on the unique indexes and re-read. A reused lead only fills
  blanks (first source and child stay; a sibling is a note, ADR 0007) and gets the door's note
  ("Came in again, 25 Nov, Ravi K." / "Enquired again on the website").
- **`src/admissions/lib/intake.ts`** is the one TS entry: phone through M7's `sheetPhone`; date of birth parsed day
  first (14/03/2022, 2022-03-14, 14 March 2022); campus = the one active campus whose window holds the date
  (`born_from` ≤ dob < `born_before`, the cut-off). No match, or two matches, routes nowhere and staff pick. The grade is
  set only when the campus names a single grade.
- **WhatsApp door** = the flows engine's `dispatchInboundToFlows`, which the webhook calls on every new inbound: after
  the run handles the message, intake runs with the run's vars (`child_name`, `child_dob`, `area`, `parent_name`). The
  starter template "Admissions welcome" asks child name and date of birth; Nimish edits its words in Flows. A message
  with no code never reopens a closed family (a "thank you" after admission is not an enquiry); a scanned QR does.
- **Source code = the source's tag** (unique per account, never changed after creation). Link:
  `https://wa.me/<number>?text=Hi! I'd like to know about admissions at Cornerstone. (ref: <tag>)`; the number comes
  from wacrm's health check (Meta). Sources tab: Copy link, and QR downloads an SVG (`qrcode-generator`, MIT, zero
  dependencies, ships types; chosen over `qrcode`, which needs pngjs, yargs and a separate `@types` package). A code is
  looked up in the receiving account only: unknown or another account's code → source WhatsApp.
- **Website form** `POST /api/admissions/intake/website`: public; account from server env `ADMISSIONS_ACCOUNT_ID`, never
  from the request; JSON or a plain form post (no CORS preflight); every field length- and type-checked; 5 per IP per
  10 minutes; answers `{ok: true}` whether or not the family was known.
- **Quick-add** `/quick-add` + `POST /api/admissions/intake` (agent+): sources Walk-in and Phone call (tags `walk_in`,
  `phone_call`, names from Settings); the dashboard frame drops the sidebar on this page (wireframe frame "bare").

## Consequences
- Sources named `whatsapp`, `website`, `walk_in`, `phone_call` must exist for those doors to tag a source (seeded
  locally); a missing one leaves the lead's source empty.
- One campus window per campus cannot split a grade range by age: per-grade cut-offs would need a new campus value
  shape (a later ADR), or one campus row per grade.
- Not done: telling the office when a known family comes in again (only the note); keeping staff to quick-add only
  (they can still open other pages); a quick-add link in the sidebar (S-frame is approved as is).

## Review fixes (#91 security review, migration 121)
- **Website form spam.** The per-IP limit is in memory (per process) and keyed on `getClientIp`, which trusts
  `X-Real-IP` first. **Production must sit behind a proxy that overwrites `X-Real-IP`** (and appends to
  `X-Forwarded-For`); otherwise a bot rotates the header and the limit is void. Added: a honeypot input `website_url`
  (hidden on the website's form; filled → the same 201, nothing written) and an optional `started_at` (ms, set when
  the form is shown; under 3 s → the same 201, nothing written). Both stop naive bots only; a CAPTCHA is the next step.
- **The website form never changes a known family.** It passes `fill = false`: an existing lead and contact keep their
  fields exactly, and the form only adds a note. An anonymous form can no longer write a known family's child or name.
- **A known family's note carries what was submitted** (child, date of birth, grade, source), so a sibling's details
  are kept (ADR 0007). WhatsApp, which has no note of its own, writes "Another enquiry on this number: …" only when
  the child or date of birth differs from the lead's, and never the same note twice.
- **Switched-off sources are never set** (`AND s.active`); the next listed tag that is on wins, else none.
- **Quick-add saves with no source** when Walk-in / Phone call are missing or switched off; the lead's source is empty.
