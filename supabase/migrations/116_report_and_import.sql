-- 116 — M7 funnel report and sheet import (#71, ADR 0027). Both run as the caller, so RLS scopes them to the
-- caller's account and refuses what the caller may not write.

-- 1. admissions_report: every number S-report shows, from leads and stage history, for leads created in [from, to).
--    reached  = leads whose furthest stage (by position) is at or after this one; a skipped stage counts as passed.
--    on_board = open leads (no exit) whose deal sits in this stage now: the board's lane count; not period-limited.
--    A stay in a stage ends when the next one starts, else at the lead's exit, else now (still there). The last
--    stage (Admitted) has no end, so it has no stay. Days are whole days on the India calendar, as days in stage.
--    shortcut: assumes the account's leads sit in one pipeline (the Admissions one); stage positions of a second
--    pipeline would mix in. Upgrade by passing a pipeline id if a second admissions pipeline ever exists.
CREATE FUNCTION public.admissions_report(p_account_id uuid, p_from timestamptz, p_to timestamptz, p_campus_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH st AS (
    SELECT s.id, s.name, s.position FROM pipeline_stages s
    WHERE s.pipeline_id IN (SELECT d.pipeline_id FROM leads x JOIN deals d ON d.id = x.deal_id WHERE x.account_id = p_account_id)
  ),
  l AS (
    SELECT * FROM leads
    WHERE account_id = p_account_id AND created_at >= p_from AND created_at < p_to
      AND (p_campus_id IS NULL OR campus_id = p_campus_id)
  ),
  h AS (
    SELECT h.lead_id, h.stage_id, st.position, h.entered_at,
      coalesce(lead(h.entered_at) OVER (PARTITION BY h.lead_id ORDER BY h.entered_at, h.id), l.exited_at,
               CASE WHEN l.admitted_at IS NULL THEN now() END) AS left_at
    FROM lead_stage_history h JOIN l ON l.id = h.lead_id JOIN st ON st.id = h.stage_id
  ),
  top AS (SELECT lead_id, max(position) AS top FROM h GROUP BY lead_id),
  stay AS (
    SELECT stage_id, (left_at AT TIME ZONE 'Asia/Kolkata')::date - (entered_at AT TIME ZONE 'Asia/Kolkata')::date AS days
    FROM h WHERE left_at IS NOT NULL
  )
  SELECT jsonb_build_object(
    'leads', (SELECT count(*) FROM l),
    'admitted', (SELECT count(*) FROM l WHERE admitted_at IS NOT NULL),
    'lost', (SELECT count(*) FROM l WHERE exit = 'lost'),
    'dormant', (SELECT count(*) FROM l WHERE exit = 'dormant'),
    'days_to_admit', (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY
        (admitted_at AT TIME ZONE 'Asia/Kolkata')::date - (created_at AT TIME ZONE 'Asia/Kolkata')::date)
      FROM l WHERE admitted_at IS NOT NULL),
    'stages', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', st.id, 'name', st.name,
        'reached', (SELECT count(*) FROM top WHERE top.top >= st.position),
        'on_board', (SELECT count(*) FROM leads x JOIN deals d ON d.id = x.deal_id
                     WHERE x.account_id = p_account_id AND x.exit IS NULL AND d.stage_id = st.id
                       AND (p_campus_id IS NULL OR x.campus_id = p_campus_id)),
        'median_days', (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY days) FROM stay WHERE stay.stage_id = st.id),
        'open_days', (SELECT coalesce(jsonb_agg(lead_days_in_stage(l.id)), '[]') FROM l JOIN deals d ON d.id = l.deal_id
                      WHERE l.exit IS NULL AND l.admitted_at IS NULL AND d.stage_id = st.id)
      ) ORDER BY st.position) FROM st), '[]'),
    'sources', coalesce((SELECT jsonb_agg(jsonb_build_object('label', s.label, 'leads', g.n, 'admitted', g.admitted))
      FROM (SELECT source_id, count(*) AS n, count(*) FILTER (WHERE admitted_at IS NOT NULL) AS admitted FROM l GROUP BY source_id) g
      LEFT JOIN admissions_settings s ON s.id = g.source_id), '[]'),
    'lost_reasons', coalesce((SELECT jsonb_agg(jsonb_build_object('label', s.label, 'n', g.n) ORDER BY g.n DESC)
      FROM (SELECT lost_reason_id, count(*) AS n FROM l WHERE exit = 'lost' GROUP BY lost_reason_id) g
      JOIN admissions_settings s ON s.id = g.lost_reason_id), '[]')
  )
$$;

REVOKE ALL ON FUNCTION public.admissions_report(uuid, timestamptz, timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admissions_report(uuid, timestamptz, timestamptz, uuid) TO authenticated, service_role;

-- 2. import_leads: opens one lead per row of the old enquiry sheet, already validated by the API
--    (src/admissions/lib/import.ts). Each row: {phone (digits with country code), parent, child, grade, area,
--    campus_id, source_id, stage_id}. Dedupe by phone (G7.1): a parent whose number is already a contact is reused,
--    never copied; a parent who already has an open lead is a duplicate and gets nothing, which also covers the same
--    number twice in one file. Each row is its own savepoint: a failing row leaves no contact, deal or lead behind.
--    No message is sent: no trigger on these tables messages anyone ("old leads imported silently", PROJECT.md).
--    Returns one {status: imported|duplicate|failed, error} per row, in order.
CREATE FUNCTION public.import_leads(p_account_id uuid, p_rows jsonb)
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
  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    BEGIN
      SELECT id INTO v_contact FROM contacts
        WHERE account_id = p_account_id AND phone_normalized = r->>'phone' LIMIT 1;
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
      INSERT INTO leads (account_id, deal_id, contact_id, child_name, grade, area, campus_id, source_id)
        VALUES (p_account_id, v_deal, v_contact, nullif(r->>'child', ''), nullif(r->>'grade', ''),
                nullif(r->>'area', ''), (r->>'campus_id')::uuid, (r->>'source_id')::uuid);
      v_out := v_out || jsonb_build_object('status', 'imported');
    EXCEPTION WHEN unique_violation THEN
      v_out := v_out || jsonb_build_object('status', 'duplicate');
    WHEN OTHERS THEN
      -- A refusal (RLS, a check) is reported per row; anything unexpected still aborts the whole import.
      IF SQLSTATE NOT IN ('42501', '23514', '23503', '23502', '22P02') THEN RAISE; END IF;
      v_out := v_out || jsonb_build_object('status', 'failed', 'error', SQLERRM);
    END;
  END LOOP;
  RETURN v_out;
END $$;

REVOKE ALL ON FUNCTION public.import_leads(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_leads(uuid, jsonb) TO authenticated, service_role;
