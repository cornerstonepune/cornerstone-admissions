# HANDOFF

_Overwritten at the end of every session. Keep under 30 lines. Facts only._

**Updated:** 2026-11-26 · **By:** builder (#68) · **Model:** claude-opus-5-5
**Milestone:** M5 — Booking · **Branch:** m5-booking

## State
- Cal.com webhook `POST /api/admissions/calcom` (signed, fails closed without `CALCOM_WEBHOOK_SECRET`), migration 120
  (`calcom_book` / `calcom_cancel` / `calcom_no_show` / `claim_visit_reminders`, 3 stamps on `visits`), ADR 0030.
- Booking moves the lead to Visit booked once (replay-safe); cancel moves it back; reschedule = new visit row; no-show =
  rebook message + one call task. RSVP T-24h, morning reminder 08:00 IST, unconfirmed call task by 18:00 the evening
  before, all from wacrm's automations cron (`runVisitReminders`), no new scheduler.
- `visitLink()` (src/admissions/lib/booking.ts) builds a campus's Cal.com link with name, phone and lead id prefilled.
- Setup for Nimish: docs/calcom-setup.md. Tests: route unit tests (fixtures) + tests/db/m5-booking.test.ts.
- Security review fixes (in 120 itself): claims capped at 50 per run with SKIP LOCKED; sends use the approved
  template's language; a link's lead id needs a matching phone; closed link lead falls through; siblings → latest
  lead; +91 matches 10-digit imported numbers; cancel goes back by stage position, stores a cancel that beats its
  booking; no-show ignores closed leads.

## Next step
1. Security review (webhook), then merge once CI is green. The cron runs follow-ups (#69) then visit reminders.
2. M4's welcome flow sends `visitLink(campus.visit_link, lead)`; nothing calls it yet.

## Blocked / open questions
- No Cal.com account yet: built from Cal.com's docs. Unverified live: hex signature encoding, `metadata[lead]` from the
  link reaching `payload.metadata`, where a filled phone answer sits. Phone fallback covers the metadata case.
- An unknown phone writes nothing (logged); the family would be missed if they booked without our link.
- Template names and times are fixed in migration 120, not in Settings.

## Don't repeat
- The shared local DB has other branches' migrations (115–119), so `supabase migration up` refuses: apply a new
  migration with `psql -1 -f` and add its row to `supabase_migrations.schema_migrations`; keep only your objects
  when regenerating `db/schema.sql`.
