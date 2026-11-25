-- Invariant 7: every insert/update/delete of an admissions setting leaves one settings_changes row.
-- SECURITY DEFINER because RLS gives members no write access to settings_changes, so they can't forge one.
CREATE OR REPLACE FUNCTION public.audit_admissions_settings() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.admissions_settings := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
BEGIN
  -- Skipped when the whole account is being deleted (cascade): the FK to accounts would fail.
  INSERT INTO public.settings_changes (account_id, setting_id, kind, key, action, old_value, new_value, changed_by)
  SELECT r.account_id, r.id, r.kind, r.key, lower(TG_OP)::public.settings_change_action,
         CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
         CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
         auth.uid()
  WHERE EXISTS (SELECT 1 FROM public.accounts WHERE id = r.account_id);
  RETURN NULL;
END;
$$;

CREATE TRIGGER audit_admissions_settings AFTER INSERT OR UPDATE OR DELETE ON public.admissions_settings
  FOR EACH ROW EXECUTE FUNCTION public.audit_admissions_settings();
