-- 103 — lead integrity (spec docs/spec/m0-data-model.md; ADR 0010, 0011, 0013 §1).
-- Every rejection is 23514 with one plain sentence (a missing id and another account's id read the same).
-- Triggers and the admissions_settings lookups run as the caller (RLS applies). Only two tiny SECURITY DEFINER helpers
-- exist, for upstream tables agents cannot SELECT (deals, messages/conversations); each returns just a boolean.

CREATE OR REPLACE FUNCTION public.admissions_setting_is(
  p_setting_id uuid, p_account_id uuid, p_kind public.admissions_setting_kind
) RETURNS boolean
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT p_setting_id IS NULL OR EXISTS (
    SELECT 1 FROM public.admissions_settings s
    WHERE s.id = p_setting_id AND s.account_id = p_account_id AND s.kind = p_kind)
$$;

CREATE FUNCTION public.deal_matches_lead(p_deal_id uuid, p_account_id uuid, p_contact_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.deals
    WHERE id = p_deal_id AND account_id = p_account_id AND contact_id IS NOT DISTINCT FROM p_contact_id)
$$;

CREATE FUNCTION public.message_in_account(p_message_id uuid, p_account_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.messages m JOIN public.conversations c ON c.id = m.conversation_id
    WHERE m.id = p_message_id AND c.account_id = p_account_id)
$$;

CREATE FUNCTION public.check_lead_integrity() RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
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

CREATE TRIGGER leads_check_integrity BEFORE INSERT OR UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.check_lead_integrity();

CREATE FUNCTION public.check_visit_refs() RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  IF NOT public.admissions_setting_is(NEW.campus_id, NEW.account_id, 'campus') THEN
    RAISE EXCEPTION 'A visit can only use a campus setting of its own account' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.leads WHERE id = NEW.lead_id AND account_id = NEW.account_id) THEN
    RAISE EXCEPTION 'A visit can only belong to a lead of its own account' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER visits_check_refs BEFORE INSERT OR UPDATE ON public.visits
  FOR EACH ROW EXECUTE FUNCTION public.check_visit_refs();

CREATE FUNCTION public.check_lead_activity_refs() RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  IF NOT public.admissions_setting_is(NEW.rule_id, NEW.account_id, 'follow_up_rule') THEN
    RAISE EXCEPTION 'A lead activity can only use a follow-up rule of its own account' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.leads WHERE id = NEW.lead_id AND account_id = NEW.account_id) THEN
    RAISE EXCEPTION 'A lead activity can only belong to a lead of its own account' USING ERRCODE = '23514';
  END IF;
  IF NEW.stage_history_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.lead_stage_history WHERE id = NEW.stage_history_id AND lead_id = NEW.lead_id) THEN
    RAISE EXCEPTION 'A lead activity can only point at a stage entry of its own lead' USING ERRCODE = '23514';
  END IF;
  IF NEW.message_id IS NOT NULL AND NOT public.message_in_account(NEW.message_id, NEW.account_id) THEN
    RAISE EXCEPTION 'A lead activity can only point at a message of its own account' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER lead_activity_check_refs BEFORE INSERT OR UPDATE ON public.lead_activity
  FOR EACH ROW EXECUTE FUNCTION public.check_lead_activity_refs();

-- AFTER, not BEFORE: leads_check_integrity must see the deal as stored. A clash with another open lead is left to the unique index (23505).
CREATE FUNCTION public.sync_lead_contact() RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.leads WHERE deal_id = NEW.id) THEN
    IF NEW.account_id IS DISTINCT FROM OLD.account_id THEN
      RAISE EXCEPTION 'A deal with a lead cannot move to another account' USING ERRCODE = '23514';
    END IF;
    IF NEW.contact_id IS NULL THEN
      RAISE EXCEPTION 'A deal with a lead must keep its contact' USING ERRCODE = '23514';
    END IF;
    UPDATE public.leads SET contact_id = NEW.contact_id WHERE deal_id = NEW.id AND contact_id IS DISTINCT FROM NEW.contact_id;
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER deals_sync_lead_contact AFTER UPDATE OF contact_id, account_id ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.sync_lead_contact();
