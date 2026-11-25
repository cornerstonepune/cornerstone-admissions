# 0010 — Five new tables for admissions, not twelve

**Date:** 2026-11-25 · **Status:** accepted (Plan, unattended; the 5-table cut is proposed by Plan, Nimish to confirm on PR #20)

## Context
PROJECT.md §3 listed 12 tables M0 would add on top of wacrm's 37. Nimish said the data model is too big. The 37 upstream tables stay as they are (ADR 0009 keeps them in `public`, untouched). `schema_migrations` existed only for the rewrite-and-apply script, which ADR 0009 removed. Of the other 11, most are short lists that only Settings edits (campuses, sources, lost reasons, follow-up rules, alerts) or logs of the same kind (follow-up sends, call tasks with their call log).

## Decision
M0 adds 5 tables, in `public` next to upstream (ADR 0009), names final in the M0 spec:
1. **`leads`** — 1:1 with a deal (ADR 0007): child, source, campus, exit, lost reason, and the lead's one current visit (Cal.com booking id unique, time, status: booked, cancelled, no-show, visited). Replaces `leads` + `visits`.
2. **`lead_stage_history`** — one row per stage entered.
3. **`admissions_settings`** — one row per setting, with a `kind` (campus, source, lost reason, follow-up rule, alert), a key, a label, a `value` (jsonb), active and sort order; unique (account, kind, key). Replaces `campuses`, `sources`, `lost_reasons`, `follow_up_rules`, `alert_settings`.
4. **`lead_activity`** — one row per follow-up send, call task, or call made (the call log lives on its call task row). Replaces `follow_up_sends` + `call_tasks`.
5. **`settings_changes`** — who changed which setting, when, old and new value.

Migration history is Supabase's own (`supabase_migrations`), so no `schema_migrations` table.

## Considered
- Twelve tables, one per list: each list gets typed columns, but five more tables, five more sets of RLS policies and audit triggers, for lists of under 20 rows each. Rejected.
- Settings as one JSON document per account: smallest, but no per-row audit and no foreign key for a lost reason. Rejected.

## Consequences
- **Cost:** a setting's `value` is jsonb, so the database can't type-check a follow-up rule's day count the way a column could. The M0 spec adds a check constraint per `kind`; the Settings API validates too.
- A lost reason is a foreign key to an `admissions_settings` row; a trigger checks that row's kind is lost reason.
- A lead keeps only its current visit. Past bookings for the same lead survive only in stage history and `lead_activity`. If Akanksha wants every rescheduled visit listed, that is a sixth table later.
- Invariants 6 and 7 in PROJECT.md §3 name these tables.
