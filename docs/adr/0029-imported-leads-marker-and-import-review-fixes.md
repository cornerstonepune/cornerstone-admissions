# 0029 — Imported leads are marked `leads.imported_at`; import review fixes

**Date:** 2026-11-26 · **Status:** accepted (builder, #86 review) · **Amends:** ADR 0027

## Context
The #86 security review found: `import_leads` trusted the API's admin check, though an agent can call it through the
Data API; a parent saved without 91 wasn't matched; the body cap counted characters, not bytes; apostrophes were
stripped from names ("D'Souza"). And ADR 0027 left open how follow-ups (#69/#87) could skip imported leads.

## Decision
- **Marker: `leads.imported_at timestamptz`** (migration 117), set by `import_leads`, null for every other lead.
  The follow-up engine skips leads where it is set ("old leads imported silently"); the report can tell them apart.
- **Enquiry date:** an optional sheet column (`enquiry date`, `enquired on` or `date`; day first, 25/11/2026, or
  2026-11-25) becomes the lead's `created_at` (India midnight, never later than now), so old enquiries count in their
  own period. Without it, `created_at` is the import time. Stage history still starts on the import day.
- **Admin+ in the database too:** a non-admin caller gets every row back as failed and nothing is written.
- **Phone match:** an existing contact matches its number with or without the 91 country code (exact match first).
- **Body cap:** refused on Content-Length over 1 MB, else reading stops at 1 MB (bytes); 413 either way.
- **Cells:** only quotes wrapping a whole cell are removed.

## Consequences
- #87's follow-up claim must add `imported_at IS NULL` (not done here; that PR owns the engine).
- `admissions_report` doesn't use the marker yet; imported leads count as ordinary leads of their enquiry date.
