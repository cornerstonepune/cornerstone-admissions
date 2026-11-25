# 0010 — Six new tables for admissions, not twelve

**Date:** 2026-11-25 · **Status:** accepted by Nimish on PR #20, 2026-11-25 (he asked for a sixth table, `visits`, over Plan's five)

## Context
PROJECT.md §3 listed 12 tables M0 would add on top of wacrm's 37. Nimish said the data model is too big. The 37 upstream tables stay as they are (ADR 0009 keeps them in `public`, untouched). `schema_migrations` existed only for the rewrite-and-apply script, which ADR 0009 removed. Of the other 11, most are short lists that only Settings edits (campuses, sources, lost reasons, follow-up rules, alerts) or logs of the same kind (follow-up sends, call tasks with their call log).

Plan first proposed five, with the lead holding only its current visit. Nimish (2026-11-25): six, with a `visits` table that keeps every Cal.com booking, reschedule, cancel and no-show.

## Decision
M0 adds 6 tables, in `public` next to upstream (ADR 0009), names final in the M0 spec:
1. **`leads`** — 1:1 with a deal (ADR 0007): child, source, campus, exit, lost reason.
2. **`visits`** — one row per Cal.com booking for a lead: Cal.com booking id (unique), time, status (booked, rescheduled, cancelled, no-show, visited). A reschedule arrives from Cal.com as a new booking id: a new row, the old row marked rescheduled. The lead's current visit is derived (its latest row still booked or visited), not stored on `leads`.
3. **`lead_stage_history`** — one row per stage entered.
4. **`admissions_settings`** — one row per setting, with a `kind` (campus, source, lost reason, follow-up rule, alert), a key, a label, a `value` (jsonb), active and sort order; unique (account, kind, key). Replaces `campuses`, `sources`, `lost_reasons`, `follow_up_rules`, `alert_settings`.
5. **`lead_activity`** — one row per follow-up send, call task, or call made (the call log lives on its call task row). Replaces `follow_up_sends` + `call_tasks`.
6. **`settings_changes`** — who changed which setting, when, old and new value.

Migration history is Supabase's own (`supabase_migrations`), so no `schema_migrations` table.

## Considered
- Twelve tables, one per list: each list gets typed columns, but five more tables, five more sets of RLS policies and audit triggers, for lists of under 20 rows each. Rejected.
- Settings as one JSON document per account: smallest, but no per-row audit and no foreign key for a lost reason. Rejected.
- Five tables, current visit as columns on `leads` (Plan's first cut): earlier bookings would be lost on reschedule. Rejected by Nimish.

## Consequences
- **Cost:** a setting's `value` is jsonb, so the database can't type-check a follow-up rule's day count the way a column could. The M0 spec adds a check constraint per `kind`; the Settings API validates too.
- A lost reason is a foreign key to an `admissions_settings` row; a trigger checks that row's kind is lost reason.
- "Current visit" is a query over `visits`, so every screen reading it (board card, S-today, S-lead) uses one database view or function defined in the M0 spec.
- Invariants 6 and 7 in PROJECT.md §3 name these tables.
