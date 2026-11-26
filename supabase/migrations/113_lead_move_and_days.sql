-- 113 — M3 pipeline (#66, ADR 0024): days in stage for a whole board in one read, and one atomic lead move.

-- 1. days_in_stage(leads): 104's lead_days_in_stage as a PostgREST computed field (`leads?select=*,days_in_stage`).
--    Still computed from stage history, never stored.
CREATE FUNCTION public.days_in_stage(public.leads) RETURNS integer
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT public.lead_days_in_stage($1.id)
$$;

-- 2. move_lead: moves an open lead's deal to a stage of its own pipeline, in one transaction. 104's trigger writes the
--    history row. The last stage is Admitted (GLOSSARY): entering it stamps admitted_at, leaving it clears it.
--    Runs as the caller, so RLS applies: a lead or stage the caller can't see reads as missing (23514, no probing),
--    and a caller who may not write it gets 42501 instead of a silent no-op.
CREATE FUNCTION public.move_lead(p_lead_id uuid, p_stage_id uuid) RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_deal uuid;
  v_last boolean;
BEGIN
  SELECT l.deal_id, s.position = (SELECT max(position) FROM pipeline_stages WHERE pipeline_id = d.pipeline_id)
    INTO v_deal, v_last
  FROM leads l
  JOIN deals d ON d.id = l.deal_id
  JOIN pipeline_stages s ON s.id = p_stage_id AND s.pipeline_id = d.pipeline_id
  WHERE l.id = p_lead_id AND l.exit IS NULL;
  IF v_deal IS NULL THEN
    RAISE EXCEPTION 'An open lead can only move to a stage of its own pipeline' USING ERRCODE = '23514';
  END IF;

  UPDATE deals SET stage_id = p_stage_id WHERE id = v_deal;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'You cannot move this lead' USING ERRCODE = '42501';
  END IF;
  UPDATE leads SET admitted_at = CASE WHEN v_last THEN now() END
    WHERE id = p_lead_id AND (admitted_at IS NULL) = v_last;
END $$;

REVOKE ALL ON FUNCTION public.move_lead(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.move_lead(uuid, uuid) TO authenticated, service_role;
