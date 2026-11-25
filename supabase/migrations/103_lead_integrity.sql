-- 103 — lead integrity (spec docs/spec/m0-data-model.md; ADR 0010, 0011).
--
-- Every rejection: RAISE EXCEPTION '<plain sentence>' USING ERRCODE = '23514'. Check on INSERT and UPDATE.
--
-- Write:
--   1. public.admissions_setting_is (below): true when p_setting_id is null, or is an admissions_settings row with
--      that account_id and kind.
--   2. trigger leads_check_integrity    BEFORE INSERT OR UPDATE ON leads:
--        campus_id → 'campus', source_id → 'source', lost_reason_id → 'lost_reason' (same account);
--        account_id and contact_id must equal the deal's (deals.account_id, deals.contact_id).
--   3. trigger visits_check_campus      BEFORE INSERT OR UPDATE ON visits:        campus_id → 'campus'.
--   4. trigger lead_activity_check_rule BEFORE INSERT OR UPDATE ON lead_activity: rule_id → 'follow_up_rule'.
--   5. trigger deals_sync_lead_contact  AFTER UPDATE OF contact_id ON deals (must be AFTER: step 2 compares the lead
--      with the deal row as stored): when the deal has a lead, reject a NULL contact_id, otherwise set
--      leads.contact_id to the new contact. A clash with another open lead for that contact is left to the unique
--      index (23505). A deal without a lead is not affected.

CREATE OR REPLACE FUNCTION public.admissions_setting_is(
  p_setting_id uuid, p_account_id uuid, p_kind public.admissions_setting_kind
) RETURNS boolean
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT false  -- not implemented: replace with the real check
$$;
