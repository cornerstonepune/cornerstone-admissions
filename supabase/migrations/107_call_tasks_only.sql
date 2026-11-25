-- 107 — agents write call tasks only (invariant 6; ADR 0013 §3).
--
-- 101's lead_activity policies let an agent turn a follow_up_send into a call_task, which frees the
-- one-send-per-rule unique index. Sends are written only by the server (service_role bypasses RLS).
--
-- Write: DROP and re-CREATE these three policies, same names and roles as 101, each with AND kind = 'call_task':
--   lead_activity_insert  FOR INSERT  WITH CHECK (is_account_member(account_id, 'agent') AND kind = 'call_task')
--   lead_activity_update  FOR UPDATE  USING and WITH CHECK both (is_account_member(account_id, 'agent') AND kind = 'call_task')
--   lead_activity_delete  FOR DELETE  USING (is_account_member(account_id, 'admin') AND kind = 'call_task')
-- Leave lead_activity_select and every grant alone.

DROP POLICY lead_activity_insert ON public.lead_activity;
DROP POLICY lead_activity_update ON public.lead_activity;
DROP POLICY lead_activity_delete ON public.lead_activity;

CREATE POLICY lead_activity_insert ON public.lead_activity FOR INSERT TO authenticated
  WITH CHECK (public.is_account_member(account_id, 'agent') AND kind = 'call_task');
CREATE POLICY lead_activity_update ON public.lead_activity FOR UPDATE TO authenticated
  USING (public.is_account_member(account_id, 'agent') AND kind = 'call_task')
  WITH CHECK (public.is_account_member(account_id, 'agent') AND kind = 'call_task');
CREATE POLICY lead_activity_delete ON public.lead_activity FOR DELETE TO authenticated
  USING (public.is_account_member(account_id, 'admin') AND kind = 'call_task');
