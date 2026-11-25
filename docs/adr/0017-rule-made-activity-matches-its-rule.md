# 0017 — Rule-made activity is the kind its rule makes, and keeps its rule and stage entry

**Date:** 2026-11-26 · **Status:** accepted (Plan, unattended; Nimish can overturn) · **Amends:** ADR 0016 §Consequences (last bullet) · **Source:** reviewer of PR #55 (ticket #51)

## Context
ADR 0016 let `rule_id` sit on any activity kind and widened the invariant-6 unique index to every rule-made row: one activity per (lead, rule, stage entry). Two gaps remained:
1. The 107 update policy only checks `kind = 'call_task'`. An agent can edit a hand-made call task to add a `rule_id` and `stage_history_id`. ADR 0016 called that harmless ("it only occupies the slot the engine would fill with the same task"). It isn't: if the rule's action is `send_template`, the call task takes the slot of the WhatsApp send, the engine's `ON CONFLICT DO NOTHING` skips it, and the parent never gets the message. Nothing reports it.
2. Nothing ties a rule-made row's `kind` to the rule's `value.action`. A send can be recorded under a call-task rule and the other way round.

## Decision (migration 111, one ticket)
1. **A rule-made row is the kind its rule makes.** `send_template` → `follow_up_send`; `call_task` → `call_task`; `dormant` makes no activity row (it moves the lead), so no row may name a dormant rule. Error: `A rule-made activity must be the kind its rule makes` (23514).
2. **An activity keeps its rule and stage entry.** On UPDATE, `rule_id` and `stage_history_id` never change, for anyone (the server only ever inserts rule-made rows). Error: `A lead activity keeps its rule and stage entry` (23514).
3. **A follow-up rule in use keeps its action.** Without this, rule 1 only holds at write time. Changing `value->>'action'` of a rule that any activity uses fails: `A follow-up rule in use cannot change its action` (23514). Stage, days, template, label and `active` stay editable.
4. Rules 1–2 live in a new **AFTER INSERT OR UPDATE** row trigger on `lead_activity`, not in the BEFORE trigger `check_lead_activity_refs`: a BEFORE trigger fires before RLS WITH CHECK and would turn an agent's 42501 into 23514 (HANDOFF "Don't repeat", holdout `call-tasks-only`). Consequence of AFTER: the unique index (23505) fires before rule 1, so a duplicate in an occupied slot reports 23505.
5. Rule 3 is a new BEFORE UPDATE OF value trigger on `admissions_settings`, SECURITY DEFINER like `check_setting_in_use` (108), so the in-use lookup sees every row.

## Consequences
- Fixtures that recorded a send under a `call_task` rule now use a `send_template` rule (tests changed with this ADR, before 111).
- Retiring a rule is still `active = false`; changing what a used rule does means a new rule.
- `lead_id` stays editable on hand-made rows; on a rule-made row the fixed stage entry must belong to the lead (103 check), so a rule-made row can't move to another lead.
