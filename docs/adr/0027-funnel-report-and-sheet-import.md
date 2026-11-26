# 0027 — Funnel report from stage history; the old sheet imports through wacrm's import dialog

**Date:** 2026-11-26 · **Status:** accepted (builder, #71)

## Context
M7 needs S-report (funnel by stage and source, days per stage, lost reasons; counts that match the board, G7.2) and the
old enquiry sheet imported without duplicates (G7.1). The issue names no sheet columns, and nobody has the sheet yet
(ADMISSIONS_PROJECT.md, item 22: edit access to the old sheet). Stage history can pass PostgREST's 1000-row page within a year, so counting in the
browser would silently drop rows.

## Decision
- **Migration 116, `admissions_report(account, from, to, campus?)`:** one jsonb with every number, computed in Postgres
  as the caller (RLS scopes it; another account's id reads as empty). Leads in the period = created in [from, to).
  - *Reached* a stage = the lead's furthest stage (by position) is that one or later; a skipped stage counts as passed.
  - *On the board now* = open leads (no exit) whose deal is in the stage: the board's lane count, not period-limited.
  - *Days per stage* = median of stays. A stay ends when the next stage starts, else at the exit, else now (still
    there, so a stage where leads pile up shows it). Admitted has no stay. Whole India-calendar days, as days in stage.
- **Yardstick** = the same number for the period before (last year's same dates for "This year"); stuck limits for
  days per stage. Under 20 leads, rates are hidden and counts still show (wireframe).
- **Report is open to every member**: RLS already shows every member every lead on the board, so restricting the
  report would hide nothing. Import is admin+ (it writes many rows at once).
- **Sheet format:** CSV with a header row; columns matched by name in any case: phone (required; also mobile,
  whatsapp), parent (or name), child, grade (or class), campus, area, source, stage. A sheet with a child column is a
  lead sheet; wacrm's Parents › Import dialog sends it to `POST /api/admissions/import` instead of importing contacts.
  Campus, source and stage must match a label in Settings / the Admissions pipeline (no new settings are made); empty
  stage = Enquiry; Admitted rows are refused (only live enquiries). A number without `+` must be an Indian mobile and
  gets 91 in front, the form WhatsApp contacts have, so the two dedupe.
- **Migration 116, `import_leads(account, rows)`:** as the caller, per row in its own savepoint: reuse the contact with
  this phone or create one; if it already has an open lead the row is a duplicate (this also covers the same phone
  twice in one file); else a deal in the row's stage and its lead. A failing row leaves nothing behind and is reported
  with its line and reason. Nothing is sent to parents (no trigger on these tables messages anyone).

## Consequences
- Imported leads enter their stage on the import day, so their days in stage and the period they count in start then.
- Follow-up rules (#69) will treat imported leads like new ones from the import day; "import silently" holds only if
  the cron skips them or rules are off during the import. Open for Nimish.
- Not built from the wireframe: Download CSV, and choosing a bar to list its leads in the side panel.
