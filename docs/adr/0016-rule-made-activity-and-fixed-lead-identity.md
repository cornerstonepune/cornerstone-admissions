# 0016 — Rule-made activity names its rule and stage entry; a lead's account and deal never change

**Date:** 2026-11-26 · **Status:** accepted (Plan, unattended; Nimish can overturn) · **Supersedes:** ADR 0015 §2 · **Source:** reviewer notes on PRs #46–#50

## Context
Three reviewer follow-ups were left open at the end of M0:
1. "`lead_activity` call_task rows can still carry `rule_id` — add a CHECK that they don't." But GLOSSARY says a follow-up rule can *create a call task*, and the M0 tests already use rules with `action: "call_task"`. Forbidding `rule_id` on call tasks would leave the M6 engine no way to record which rule made a task, nor to avoid making it twice (the scheduler runs every minute).
2. `lead_activity.rule_id` is `ON DELETE SET NULL`, but `lead_activity_send_has_rule` requires a send to have a rule. Deleting a used rule therefore fails with a confusing CHECK error — or, if the CHECK were relaxed, would erase which rule sent a message.
3. 109's lead move guard looks up stage history, visits and activity before allowing an account or deal change. Since every lead gets a history row when it is created (#25), the lookups always find one: the rule is in practice "never".

## Decision (migration 110, ticket M0 · 110)
1. **Rule-made vs hand-made activity.** `rule_id` is allowed on any kind, but means "a follow-up rule made this". A rule-made row must name its stage entry (CHECK `rule_id IS NULL OR stage_history_id IS NOT NULL`), and there is at most one activity per (lead, rule, stage entry) of any kind (the invariant-6 unique index widens from sends to every rule-made row). People (agents and up) insert call tasks only with `rule_id IS NULL`; rule-made rows come from the server (service role).
2. **A used rule is deactivated, not deleted.** `rule_id` becomes `ON DELETE NO ACTION` (same as campus, source and lost reason use RESTRICT; NO ACTION so deleting a whole account still cascades). Deleting a rule some activity uses fails with 23503; `active = false` is how a rule is retired.
3. **A lead's account and deal never change on UPDATE.** `check_lead_integrity` refuses any change to `account_id` or `deal_id` (23514, "A lead's account and deal never change"), with no lookups. A wrong lead is closed and a new one made.
4. `lead_current_visit` gets a test as an account member (and as a member of another account).

## Consequences
- The M6 engine inserts rule-made activity with `ON CONFLICT DO NOTHING` on the widened index; that is the duplicate guard.
- The Settings screen (M6) offers "turn off" for a rule in use, never "delete".
- An agent can still *update* a hand-made call task to add a rule and stage entry (RLS can't compare with the old row). Harm is nil: it only occupies the slot the engine would have filled with the same task. Revisit only if a real case appears.
