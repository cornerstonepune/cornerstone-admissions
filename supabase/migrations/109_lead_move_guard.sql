-- 109 — a lead with stage history can't move to another account or deal (ADR 0015 §2; PR #34 review).
-- Copy of check_lead_integrity() from 103; only the first IF block changed (stage history added, new sentence).
CREATE OR REPLACE FUNCTION public.check_lead_integrity() RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.account_id IS DISTINCT FROM OLD.account_id OR NEW.deal_id IS DISTINCT FROM OLD.deal_id)
     AND (EXISTS (SELECT 1 FROM public.lead_stage_history WHERE lead_id = OLD.id)
          OR EXISTS (SELECT 1 FROM public.visits WHERE lead_id = OLD.id)
          OR EXISTS (SELECT 1 FROM public.lead_activity WHERE lead_id = OLD.id)) THEN
    RAISE EXCEPTION 'A lead with stage history, visits or activity cannot move to another account or deal' USING ERRCODE = '23514';
  END IF;
  IF NOT public.admissions_setting_is(NEW.campus_id, NEW.account_id, 'campus')
     OR NOT public.admissions_setting_is(NEW.source_id, NEW.account_id, 'source')
     OR NOT public.admissions_setting_is(NEW.lost_reason_id, NEW.account_id, 'lost_reason') THEN
    RAISE EXCEPTION 'A lead can only use campus, source and lost-reason settings of its own account and the right kind'
      USING ERRCODE = '23514';
  END IF;
  IF NOT public.deal_matches_lead(NEW.deal_id, NEW.account_id, NEW.contact_id) THEN
    RAISE EXCEPTION 'A lead must be in the same account and have the same contact as its deal' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
