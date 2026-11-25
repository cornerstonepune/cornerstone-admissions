-- 104 — stage history, deal status, days in stage (invariant 5; spec docs/spec/m0-data-model.md, ADR 0011).
--
-- Write:
--   1. trigger leads_record_first_stage   AFTER INSERT ON leads: one lead_stage_history row
--        (account_id = lead's, lead_id, stage_id = its deal's stage_id, moved_by = auth.uid()).
--   2. trigger deals_record_stage_change  AFTER UPDATE OF stage_id ON deals: when NEW.stage_id IS DISTINCT FROM
--        OLD.stage_id and the deal has a lead, one lead_stage_history row for the new stage. Otherwise nothing.
--   3. trigger leads_sync_deal_status     AFTER INSERT OR UPDATE OF exit, admitted_at ON leads: set deals.status to
--        'won' when admitted_at is set, 'lost' when exit is set (lost or dormant), else 'open' — only when it differs.
--        deals.closed_at is stamped by upstream's deals_stamp_closed_at; don't set it yourself.
--   0. Only these triggers write lead_stage_history (ADR 0013 §2):
--        DROP POLICY lead_stage_history_insert ON public.lead_stage_history;
--        REVOKE INSERT ON public.lead_stage_history FROM authenticated;
--      so the trigger functions of 1 and 2 are SECURITY DEFINER with SET search_path = public. They set
--      moved_by = auth.uid() and leave entered_at to its default now(); account_id comes from the lead.
--   4. the body of lead_days_in_stage (below): whole days on the India calendar since the lead's latest history row,
--        (now() AT TIME ZONE 'Asia/Kolkata')::date - (entered_at AT TIME ZONE 'Asia/Kolkata')::date.
--        NULL when the lead has no history.

CREATE OR REPLACE FUNCTION public.lead_days_in_stage(p_lead_id uuid) RETURNS integer
LANGUAGE plpgsql STABLE
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'not implemented';
END;
$$;
