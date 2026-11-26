-- 117 — sheet import review fixes (#86 review, ADR 0029).

-- 1. The marker: when a lead came from the old enquiry sheet. Null for every other lead. Follow-ups skip imported
--    leads ("old leads imported silently", PROJECT.md); the report can tell them apart.
ALTER TABLE public.leads ADD COLUMN imported_at timestamptz;
COMMENT ON COLUMN public.leads.imported_at IS
  'When import_leads opened this lead from the old enquiry sheet; null otherwise. Follow-ups skip these leads.';

-- 2. import_leads, as 116 plus:
--    - admin+ only, checked here too: the API checks it, but an agent could call this through the Data API.
--      A non-admin gets every row back as failed and nothing is written.
--    - an existing contact matches whether its phone was saved with or without 91 (rows arrive with 91).
--    - each lead gets imported_at = now(); created_at = the sheet's enquiry date when given (never later than now),
--      so old enquiries count in their own period, not the import day's.
CREATE OR REPLACE FUNCTION public.import_leads(p_account_id uuid, p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  r jsonb;
  v_contact uuid;
  v_deal uuid;
  v_out jsonb := '[]';
BEGIN
  IF NOT is_account_member(p_account_id, 'admin') THEN
    RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('status', 'failed', 'error', 'Only an owner or admin can import leads'))
                     FROM jsonb_array_elements(p_rows)), '[]');
  END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    BEGIN
      SELECT id INTO v_contact FROM contacts
        WHERE account_id = p_account_id
          AND phone_normalized IN (r->>'phone', CASE WHEN r->>'phone' ~ '^91[0-9]{10}$' THEN substr(r->>'phone', 3) END)
        ORDER BY phone_normalized = r->>'phone' DESC
        LIMIT 1;
      IF v_contact IS NOT NULL AND EXISTS (
        SELECT 1 FROM leads WHERE contact_id = v_contact AND exit IS NULL AND admitted_at IS NULL) THEN
        v_out := v_out || jsonb_build_object('status', 'duplicate');
        CONTINUE;
      END IF;
      IF v_contact IS NULL THEN
        INSERT INTO contacts (user_id, account_id, phone, name)
          VALUES (auth.uid(), p_account_id, '+' || (r->>'phone'), nullif(r->>'parent', ''))
          RETURNING id INTO v_contact;
      END IF;
      INSERT INTO deals (user_id, account_id, pipeline_id, stage_id, contact_id, title)
        SELECT auth.uid(), p_account_id, s.pipeline_id, s.id, v_contact,
               coalesce(nullif(r->>'child', ''), nullif(r->>'parent', ''), '+' || (r->>'phone'))
        FROM pipeline_stages s WHERE s.id = (r->>'stage_id')::uuid
        RETURNING id INTO v_deal;
      IF v_deal IS NULL THEN
        RAISE EXCEPTION 'Unknown stage' USING ERRCODE = '23514';
      END IF;
      INSERT INTO leads (account_id, deal_id, contact_id, child_name, grade, area, campus_id, source_id, imported_at, created_at)
        VALUES (p_account_id, v_deal, v_contact, nullif(r->>'child', ''), nullif(r->>'grade', ''),
                nullif(r->>'area', ''), (r->>'campus_id')::uuid, (r->>'source_id')::uuid,
                now(), least(coalesce((r->>'enquired_at')::timestamptz, now()), now()));
      v_out := v_out || jsonb_build_object('status', 'imported');
    EXCEPTION WHEN unique_violation THEN
      v_out := v_out || jsonb_build_object('status', 'duplicate');
    WHEN OTHERS THEN
      -- A refusal (RLS, a check) is reported per row; anything unexpected still aborts the whole import.
      IF SQLSTATE NOT IN ('42501', '23514', '23503', '23502', '22P02', '22007', '22008') THEN RAISE; END IF;
      v_out := v_out || jsonb_build_object('status', 'failed', 'error', SQLERRM);
    END;
  END LOOP;
  RETURN v_out;
END $$;
