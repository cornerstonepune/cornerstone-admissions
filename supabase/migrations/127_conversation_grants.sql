-- 127 — Staff rights on lead_conversations, stated from zero (ADR 0039).
-- The hosted database grants anon and authenticated everything on a new table by default; local does not. 125 only
-- added grants, so on hosted an agent could still insert the job columns (status, provider_job_id, created_at) the
-- service-role runner trusts. Revoke first, then grant exactly what 125 meant.
REVOKE ALL ON public.lead_conversations FROM anon, authenticated;
GRANT SELECT, DELETE ON public.lead_conversations TO authenticated;
GRANT INSERT (account_id, lead_id, kind, happened_at, created_by, audio_path, duration_s, typed_note)
  ON public.lead_conversations TO authenticated;
