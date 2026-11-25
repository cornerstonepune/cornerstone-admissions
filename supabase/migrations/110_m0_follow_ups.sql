-- 110 — M0 reviewer follow-ups (ADR 0016; supersedes ADR 0015 §2).

-- 1. A used follow-up rule can't be deleted (turn it off instead). Plain REFERENCES = NO ACTION,
--    so deleting a whole account still cascades.
ALTER TABLE public.lead_activity DROP CONSTRAINT lead_activity_rule_id_fkey,
  ADD CONSTRAINT lead_activity_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES public.admissions_settings(id);

-- 2. Rule-made activity names its stage entry.
ALTER TABLE public.lead_activity ADD CONSTRAINT lead_activity_rule_has_entry
  CHECK (rule_id IS NULL OR stage_history_id IS NOT NULL);

-- 3. One activity per (lead, rule, stage entry), any kind (invariant 6 widened).
DROP INDEX public.lead_activity_one_send_per_rule_entry;
CREATE UNIQUE INDEX lead_activity_one_per_rule_entry ON public.lead_activity (lead_id, rule_id, stage_history_id)
  WHERE rule_id IS NOT NULL;

-- 4. People add call tasks only without a rule.
DROP POLICY lead_activity_insert ON public.lead_activity;
CREATE POLICY lead_activity_insert ON public.lead_activity FOR INSERT TO authenticated
  WITH CHECK (public.is_account_member(account_id, 'agent') AND kind = 'call_task' AND rule_id IS NULL);

-- 5. A lead's account and deal never change. Copy of 109; only the first IF block changed.
CREATE OR REPLACE FUNCTION public.check_lead_integrity() RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.account_id IS DISTINCT FROM OLD.account_id OR NEW.deal_id IS DISTINCT FROM OLD.deal_id) THEN
    RAISE EXCEPTION 'A lead''s account and deal never change' USING ERRCODE = '23514';
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
