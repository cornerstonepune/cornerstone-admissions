-- 108 — a setting in use keeps its kind and account (ADR 0015 §1; PR #34 review).
--
-- Write:
--   1. the body of check_setting_in_use (below): on UPDATE, when NEW.kind IS DISTINCT FROM OLD.kind or
--        NEW.account_id IS DISTINCT FROM OLD.account_id, and OLD.id is used by any of
--          leads.campus_id, leads.source_id, leads.lost_reason_id, visits.campus_id, lead_activity.rule_id,
--        RAISE EXCEPTION 'A setting in use cannot change its kind or account' USING ERRCODE = '23514'.
--        Otherwise RETURN NEW (label, value, active, sort_order stay free; an unused setting may change anything).
--   2. CREATE TRIGGER admissions_settings_check_in_use BEFORE UPDATE OF kind, account_id ON public.admissions_settings
--        FOR EACH ROW EXECUTE FUNCTION public.check_setting_in_use();
-- Keep SECURITY DEFINER: the in-use lookups must see every row, not only the ones the caller's RLS shows. A trigger
-- function can't be called through rpc(), so this answers nothing to anyone.

CREATE OR REPLACE FUNCTION public.check_setting_in_use() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (NEW.kind IS DISTINCT FROM OLD.kind OR NEW.account_id IS DISTINCT FROM OLD.account_id)
     AND (EXISTS (SELECT 1 FROM leads WHERE campus_id = OLD.id OR source_id = OLD.id OR lost_reason_id = OLD.id)
       OR EXISTS (SELECT 1 FROM visits WHERE campus_id = OLD.id)
       OR EXISTS (SELECT 1 FROM lead_activity WHERE rule_id = OLD.id)) THEN
    RAISE EXCEPTION 'A setting in use cannot change its kind or account' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER admissions_settings_check_in_use BEFORE UPDATE OF kind, account_id ON public.admissions_settings
  FOR EACH ROW EXECUTE FUNCTION public.check_setting_in_use();
