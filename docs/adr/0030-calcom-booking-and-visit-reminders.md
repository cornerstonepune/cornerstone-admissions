# ADR 0030: Cal.com booking webhook and visit reminders

**Date:** 2026-11-26 · **Decided by:** builder for #68 (assumptions, open to Nimish) · **Status:** accepted

## Decision
1. **One signed webhook**, `POST /api/admissions/calcom`. `X-Cal-Signature-256` = hex HMAC-SHA256 of the raw body with
   `CALCOM_WEBHOOK_SECRET`, compared in constant time; no secret set means every request is refused (401). Events:
   `BOOKING_CREATED`, `BOOKING_RESCHEDULED`, `BOOKING_CANCELLED`, `BOOKING_NO_SHOW_UPDATED` (marked only); others get 200
   and are ignored. A database error answers 500 so Cal.com shows the delivery failed.
2. **The database does each event in one transaction** (migration 120, service role only): `calcom_book`,
   `calcom_cancel`, `calcom_no_show`. A booking id already in `visits` (unique) changes nothing, so a replay moves no lead
   and sends nothing (G5.1).
3. **Which lead** (`calcom_lead`; only open leads count). In order: the lead of the booking a reschedule replaces; the
   lead id our booking link carries (`metadata[lead]`), trusted only when the booking has no phone or the phone is that
   lead's parent's (a closed or mismatched link lead falls through); then by phone digits, where a +91 number also
   matches its 10 digits without 91, as the sheet import stores them. **Siblings:** open leads with that phone all in
   one account (two contacts for one family, e.g. one imported, one from WhatsApp) → the most recently created lead.
   Open leads with that phone in two accounts, or no match, write nothing and are logged (200). We do not create a lead
   from a booking: M4 owns intake.
4. **Stage moves.** A booking moves a lead that is before Visit booked to it, through `move_lead` (M3). A lead already
   further on keeps its stage. Visit booked is the pipeline's second stage by position (113 takes Admitted to be the
   last), so renaming it breaks nothing. A cancel moves the lead back (G5.2) to the latest stage in its history that
   comes before Visit booked by position, never the last stage (so never Admitted), only when it is still in Visit
   booked and has no other booked visit. A cancel that arrives before its booking is stored as a cancelled visit, so
   the late booking changes nothing. A no-show of a closed lead changes nothing. A reschedule is a new visit row, the
   old one `rescheduled`.
5. **Messages** (brief §6, §11), templates without variables, into the parent's WhatsApp conversation via wacrm's
   `engineSendTemplate`, in the approved template's own language (as follow-ups, #89): `visit_confirmed` on a booking or reschedule; `visit_missed_rebook` on a no-show, plus one call
   task; `visit_rsvp_24h` 24 hours before; `visit_reminder_morning` at 08:00 India time on the day. A reminder whose
   moment had already passed when the visit was booked is skipped.
6. **Unconfirmed = call task (G5.3).** After the RSVP, if the parent hasn't written by 18:00 the evening before (or two
   hours after a late RSVP), a call task is made for the Today list. Any message from the parent counts as a reply
   (`conversations.last_inbound_at`): a "No" is read in the inbox.
7. **Reminders run from wacrm's automations cron**, like the M6 follow-ups (ADR 0028): `claim_visit_reminders` reads the
   booked visits on each run and stamps `rsvp_sent_at`, `reminder_sent_at`, `call_task_at` on the visit before sending,
   so each goes once and a failed send is logged, not retried. At most 50 of each kind per run, soonest visit first (as
   118); each claim locks its rows with `SKIP LOCKED`, so overlapping runs never claim the same visit.

## Considered
- Queueing reminders in `automation_pending_executions` (the issue's text). Each row must point at a wacrm automation
  and its steps, wacrm has no "make a call task" step, and a reschedule or cancel would have to find and void queued
  rows. Reading the visits on each cron run needs no queue and follows the visit's current time and status.
- Creating a lead from an unknown phone: the booking would carry no child, campus or source; left to staff and M4.

## Not built
- Template names and times in Settings (fixed in migration 120, marked `shortcut:`).
- Marking a visit "visited" (staff do it on the board, Visited stage).
- A send failure is in the server log only; the lead panel doesn't show it.
- Verified against Cal.com's docs and fixtures, not a live Cal.com account (Nimish has none yet).
