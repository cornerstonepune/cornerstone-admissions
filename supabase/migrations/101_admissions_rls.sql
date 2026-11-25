-- 101 — RLS policies on the six admissions tables (G0.3, invariant 2; ADR 0006, spec docs/spec/m0-data-model.md).
--
-- RLS is already ON for all six (migration 100). Write exactly these policies, nothing else:
--
--   table                 select            insert            update            delete
--   admissions_settings   member (viewer)   admin             admin             admin
--   leads                 member            agent             agent             admin
--   visits                member            agent             agent             admin
--   lead_stage_history    member            agent             (none: append-only)  (none)
--   lead_activity         member            agent             agent             admin
--   settings_changes      member            (none: written only by 105's trigger)
--
-- Names: <table>_select, <table>_insert, <table>_update, <table>_delete.
-- "member" = public.is_account_member(account_id); "agent"/"admin" = public.is_account_member(account_id, '<role>').
-- INSERT: WITH CHECK. UPDATE: USING and WITH CHECK, same role. Copy the deals_* policies in db/schema.sql.
--
-- GRANTS FIRST. This Supabase gives new public tables no SELECT/INSERT/UPDATE/DELETE for `authenticated`
-- (check: `\dp deals` shows authenticated=Dxtm), so policies alone return "permission denied". Grant
-- SELECT, INSERT, UPDATE, DELETE on all six tables to authenticated, and ALL to service_role; nothing to anon.
-- RLS then narrows access: a refused UPDATE/DELETE must touch 0 rows, not raise.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.admissions_settings, public.leads, public.visits,
  public.lead_stage_history, public.lead_activity, public.settings_changes TO authenticated;
GRANT ALL ON public.admissions_settings, public.leads, public.visits,
  public.lead_stage_history, public.lead_activity, public.settings_changes TO service_role;

CREATE POLICY admissions_settings_select ON public.admissions_settings FOR SELECT TO authenticated USING (public.is_account_member(account_id));
CREATE POLICY admissions_settings_insert ON public.admissions_settings FOR INSERT TO authenticated WITH CHECK (public.is_account_member(account_id, 'admin'));
CREATE POLICY admissions_settings_update ON public.admissions_settings FOR UPDATE TO authenticated USING (public.is_account_member(account_id, 'admin')) WITH CHECK (public.is_account_member(account_id, 'admin'));
CREATE POLICY admissions_settings_delete ON public.admissions_settings FOR DELETE TO authenticated USING (public.is_account_member(account_id, 'admin'));

CREATE POLICY leads_select ON public.leads FOR SELECT TO authenticated USING (public.is_account_member(account_id));
CREATE POLICY leads_insert ON public.leads FOR INSERT TO authenticated WITH CHECK (public.is_account_member(account_id, 'agent'));
CREATE POLICY leads_update ON public.leads FOR UPDATE TO authenticated USING (public.is_account_member(account_id, 'agent')) WITH CHECK (public.is_account_member(account_id, 'agent'));
CREATE POLICY leads_delete ON public.leads FOR DELETE TO authenticated USING (public.is_account_member(account_id, 'admin'));

CREATE POLICY visits_select ON public.visits FOR SELECT TO authenticated USING (public.is_account_member(account_id));
CREATE POLICY visits_insert ON public.visits FOR INSERT TO authenticated WITH CHECK (public.is_account_member(account_id, 'agent'));
CREATE POLICY visits_update ON public.visits FOR UPDATE TO authenticated USING (public.is_account_member(account_id, 'agent')) WITH CHECK (public.is_account_member(account_id, 'agent'));
CREATE POLICY visits_delete ON public.visits FOR DELETE TO authenticated USING (public.is_account_member(account_id, 'admin'));

CREATE POLICY lead_stage_history_select ON public.lead_stage_history FOR SELECT TO authenticated USING (public.is_account_member(account_id));
CREATE POLICY lead_stage_history_insert ON public.lead_stage_history FOR INSERT TO authenticated WITH CHECK (public.is_account_member(account_id, 'agent'));

CREATE POLICY lead_activity_select ON public.lead_activity FOR SELECT TO authenticated USING (public.is_account_member(account_id));
CREATE POLICY lead_activity_insert ON public.lead_activity FOR INSERT TO authenticated WITH CHECK (public.is_account_member(account_id, 'agent'));
CREATE POLICY lead_activity_update ON public.lead_activity FOR UPDATE TO authenticated USING (public.is_account_member(account_id, 'agent')) WITH CHECK (public.is_account_member(account_id, 'agent'));
CREATE POLICY lead_activity_delete ON public.lead_activity FOR DELETE TO authenticated USING (public.is_account_member(account_id, 'admin'));

CREATE POLICY settings_changes_select ON public.settings_changes FOR SELECT TO authenticated USING (public.is_account_member(account_id));
