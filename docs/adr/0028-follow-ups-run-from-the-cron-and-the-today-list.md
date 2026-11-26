# ADR 0028: Follow-ups run from wacrm's cron; what the Today list counts

**Date:** 2026-11-26 · **Decided by:** builder for #69 (assumptions, open to Nimish) · **Status:** accepted

## Decision
1. **No queue table, no second scheduler.** `lead_activity` is the record of each follow-up. wacrm's automations cron
   (`/api/automations/cron`, `x-cron-secret`) calls `runFollowUps` (src/admissions/lib/follow-ups.ts) on every run, which
   calls `claim_due_follow_ups()` (migration 115, service role only).
2. **Due** = an open lead's current stage entry is in an active rule's stage and the rule's days have passed, in India
   calendar days (as `days_in_stage`). The rule is read on every run, so a changed day count or a rule switched off
   applies on the next run. Days 0 means as soon as the lead enters the stage.
3. **Once.** The claim inserts with `ON CONFLICT DO NOTHING` on invariant 6 (one row per lead, rule and stage entry), then
   sends. Claim-before-send means a crash or a Meta error never sends twice; a failed send is kept with outcome
   "Not sent" and the error in notes, and is not retried. A lead that leaves the stage and comes back gets a new entry,
   so the rule can follow up again.
4. **Pause on reply.** Any message from the parent after the lead entered its stage (`conversations.last_inbound_at`)
   stops that stage's follow-ups — sends, call tasks and Dormant alike (GLOSSARY: Follow-up). Moving the lead to another
   stage starts them again. Call tasks already made stay on the Today list.
5. **Actions.** send_template → `follow_up_send` sent through wacrm's `engineSendTemplate` into the parent's
   conversation (no template variables); call_task → a `call_task` due now; dormant → the lead closes as Dormant.
6. **Untouched** (Today list): the family is waiting on us — a new lead, or the parent wrote last — and no one has acted
   since (a stage move by a person, a call logged, a staff reply) for longer than the `untouched` alert's hours. A lead
   quietly waiting with nothing owed is not untouched. A family shows once in "Call now": untouched beats its call tasks.
7. **Today** is the India day. Calls due = open call tasks due before tonight, overdue first. Stuck = `isStuck` (M3).
8. **Old leads from a sheet import (M7, `import_leads`, migration 116).** The import leaves no mark on a lead, so
   follow-ups cannot tell an imported lead from a new one yet: a follow-up fix after the M7 import mark lands skips
   the stage entry an import created. Untouched needs nothing extra: the import's first stage entry is the staff
   member's (`moved_by`), at the creation moment, so an imported lead counts as acted on until the parent writes.

## Considered
- Queue the sends at stage change with a fixed `due_at`: a later change to the rule's days would not apply (G6.2).
- Untouched as "no action in N hours" for every open lead: nearly the whole pipeline would be red on a quiet day.

## Not built
- A call task when a parent replies (GLOSSARY lists it as a source of call tasks); Mine / Everyone filter (rule-made
  tasks have no owner yet); "+ Add a lead" (Quick-add); the sidebar's Today count; visit "to confirm" (no such status).
