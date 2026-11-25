-- 105 — settings audit trail (invariant 7; spec docs/spec/m0-data-model.md, ADR 0011).
--
-- Write:
--   1. the body of audit_admissions_settings (below): insert one settings_changes row per changed row —
--        account_id, setting_id, kind, key from NEW (from OLD on delete);
--        action = lower(TG_OP); old_value = to_jsonb(OLD) (null on insert); new_value = to_jsonb(NEW) (null on delete);
--        changed_by = auth.uid(). RETURN NULL.
--   2. trigger audit_admissions_settings AFTER INSERT OR UPDATE OR DELETE ON public.admissions_settings
--        FOR EACH ROW EXECUTE FUNCTION public.audit_admissions_settings();
-- Keep SECURITY DEFINER: RLS gives nobody write access to settings_changes.

CREATE OR REPLACE FUNCTION public.audit_admissions_settings() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'not implemented';
END;
$$;
