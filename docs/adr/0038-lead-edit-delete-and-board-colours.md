# 0038 — Edit and delete a lead; stage colours and an admissions board

**Date:** 2026-11-26 · **Status:** accepted (Nimish's feedback on the live Pipeline screen, in chat)

## Context
Staff could not fix a typo in a lead, add a parent's email, or remove a duplicate or a spam enquiry. The board still
spoke wacrm's sales language ("Add Deal", ₹0 under each stage, pipeline value, average deal size), every stage looked
the same, and on a Mac the sideways scrollbar sat below a very tall board, so the six stages could not be reached.

## Decision
- **Delete is a hard delete, for admins only.** Lost and Dormant stay the way to close a real lead (they keep the
  history the funnel report counts). Delete is for mistakes, duplicates and spam, so it removes the lead outright.
  `DELETE /api/admissions/leads/[id]` (`requireRole("admin")`) deletes the lead's deal; `leads.deal_id` cascades and
  the lead's stage history, calls, follow-ups and visits cascade from the lead. The parent's contact and WhatsApp
  conversation stay (they may have another child). Migration 124 makes `deals_delete` need an admin when the deal
  carries a lead, so an agent cannot get round the API by deleting the deal directly; a deal without a lead keeps
  upstream's agent rule. The panel asks first, in words that say it is permanent.
- **Edit mode** in the lead panel: child name, date of birth, grade, campus, area, source, notes, parent name, phone,
  email. `PATCH { fields }`, agent and up. The server checks everything again: text lengths, a real past date, an email
  shape, a phone that normalises to a mobile (stored as digits with the country code, as intake does), and a campus or
  source that is this account's setting of that kind. A phone another contact of the account already has is a 409
  with a plain message (one contact per phone, migration 022). The parent's details live on the contact, so changing
  them changes them for each of that parent's children, and a new phone is where WhatsApp messages go from then on.
- **Parent email** shows in the panel and quick-add takes it (optional; it fills an empty email, never overwrites).
- **Stage colours by position**, from the token palette (`--kind-*`, `--state-ok`; ADR 0003's tokens.css, unchanged),
  so no data changes: column bar and dot, the panel's stepper and eyebrow, and a 4px edge on each card. Admitted, the
  sixth, is green. `pipeline_stages.color` (upstream's hex) is no longer read by this board.
- **Campus tag** coloured by the campus's sort order; **grade tag** when set.
- **Numbers above the board** are admissions numbers, each with a yardstick: stuck (of open), open leads, new in 7 days
  (vs the 7 before), visits booked (how many in the next 7 days), admitted and lost this month (vs all of last month),
  and one line saying what to look at first. No money anywhere.
- **"Add lead"** opens the quick-add form (`/quick-add`); the per-column add (a plain deal) is gone.
- **Scrolling:** on a laptop the page is the window's height and the board takes the rest, each column scrolling on its
  own, so the sideways scrollbar is always in view; columns shrink to a 10rem minimum so six fit at 1440px. Phones keep
  swipe-and-snap and page scrolling.

## Consequences
- Deleted leads are gone from the funnel report and cannot be restored. Admins only, behind a confirm.
- Lead edits across contact, lead and deal are three writes, not one transaction; the contact (the only one that can
  clash) goes first, so a phone clash changes nothing.
