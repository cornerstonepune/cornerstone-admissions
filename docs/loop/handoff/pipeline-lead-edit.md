# Handoff — feat/pipeline-lead-edit · Edit and delete a lead, admissions board

## What I did (ADR 0038)
- Lead panel: "…" menu with Edit details (agent+) and Delete lead (admin, inline confirm); parent email shown.
- `src/app/api/admissions/leads/[id]/route.ts`: `PATCH { fields }` (validated in `parseLeadFields`, saved by
  `editLead`, phone clash → 409) and `DELETE` (admin). Logic in `src/admissions/lib/pipeline.ts`.
- Migration 124: `deals_delete` needs an admin for a deal that carries a lead. `db/schema.sql` regenerated.
- Board: stage colours by position, campus and grade tags, days in stage, stuck tint, admissions numbers instead of
  deal values (`src/admissions/components/pipeline-stats.tsx`), "Add lead" → `/quick-add`, no ₹0, board fills the
  window height with columns scrolling inside. `pipeline-analytics.tsx` deleted (unused).
- Quick-add takes an optional parent email.

## Proof
- Unit: `src/app/api/admissions/leads/[id]/edit-delete.test.ts`, `src/admissions/lib/pipeline.test.ts`,
  `src/app/api/admissions/intake/route.test.ts`. DB: `tests/db/lead-delete.test.ts` (admin can, agent cannot, other
  account cannot, contact and conversation stay).
- Clicked through locally (seeded local Supabase; 1440×900, 1100×760, phone): six stages fit at 1440; at 1100 the
  board scrolls sideways with its scrollbar in view; the phone keeps snap. Edit saved an email; a clashing phone
  showed the 409 message; Delete removed the lead and the board and numbers refreshed.

## Open
- Not merged; Nimish clicks through on the test host after merge.
- `messages/{es,ko,pt}.json` still say "deal"; the app runs in English.
