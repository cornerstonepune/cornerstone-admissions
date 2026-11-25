# 0013 — Same-account links, trigger-only stage history, agents write call tasks only

**Date:** 2026-11-25 · **Status:** accepted (Plan, unattended; Nimish not present, so the choices below are assumptions he can overturn)

## Context
The reviewer of PR #29 (migration 101, ticket #22, merged) found that the policies check only each row's own
`account_id`:
1. Foreign keys bypass RLS. An agent of account A can insert a `visits` / `lead_activity` / `lead_stage_history` row
   with `account_id = A` that points at B's `lead_id`, `stage_id` or `stage_history_id`, and can probe B's ids from the
   FK error ("does not exist" vs success).
2. `lead_stage_history_insert` lets an agent write any stage, a backdated `entered_at`, someone else's `moved_by`.
   Days in stage (invariant 5) and the funnel would then be whatever an agent typed.
3. `lead_activity_update` lets an agent turn a `follow_up_send` into a `call_task`, which drops it out of the partial
   unique index `lead_activity_one_send_per_rule_entry`, so the rules engine sends again (breaks invariant 6).
4. No test showed a refused agent UPDATE/DELETE on `admissions_settings`, or DELETE on `visits`/`lead_activity`,
   touches 0 rows.

## Decision
1. **Same-account links are checked by trigger, in 103 (#24).** BEFORE INSERT OR UPDATE triggers on `visits`
   (`lead_id`) and `lead_activity` (`lead_id`; `stage_history_id` must belong to the same lead; `message_id` must
   belong to a conversation of the same account) reject with 23514 and one sentence. The check reads under the
   caller's RLS (SECURITY INVOKER), so another account's id and a non-existent id get the same error: no probing.
   A trigger, not a policy `WITH CHECK`, because #24 already owns these triggers and errors there name the problem.
2. **Only 104's triggers write `lead_stage_history` (#25).** 104 revokes INSERT on it from `authenticated` and drops
   `lead_stage_history_insert`; its trigger functions are SECURITY DEFINER, set `moved_by = auth.uid()` and leave
   `entered_at` to its default `now()`. So a history row can only come from a real stage change, stamped now, by
   whoever made it. The account comes from the lead, so decision 1 isn't needed for this table.
3. **Agents write call tasks only (#30, migration 107).** `lead_activity` insert, update and delete policies
   add `kind = 'call_task'` (USING and WITH CHECK). `follow_up_send` rows are written only by the server
   (service_role, M3 rules engine), which bypasses RLS. Assumption: no screen lets a person create, edit or delete a
   send; if M3 needs one, it goes through a server route.
4. **Regression tests for 101** go straight to main (`tests/db/rls-refusals.test.ts`): they pass today, and were
   proven to fail against a deliberately loosened policy.

## Consequences
- 101 stays as merged; 103, 104 and 107 tighten it. Until they merge, the gaps are open on local Supabase only
  (no hosted project before M7, ADR 0009).
- Upstream's `deals.stage_id` can still point at another account's stage (upstream policies, untouched); the
  history trigger copies whatever the deal holds. Out of M0 scope; noted for the upstream-grants work (ADR 0012).
- Hidden RLS test changes (on the seeds, merged with their tickets): "keeps stage history append-only" expects an
  agent's direct insert to be refused (42501, plan/t25); `fill()` reuses the history row 104's trigger writes
  (plan/t25); "stops an agent writing into another account" accepts 23514 or 42501, because 103's BEFORE trigger
  runs ahead of RLS's WITH CHECK (plan/t24).
