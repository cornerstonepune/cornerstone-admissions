-- 126 — Days to admit leaves out leads imported from the old sheet: their dates are the import's (ADR 0036).
-- admissions_report is 116's definition with that one condition added.

CREATE OR REPLACE FUNCTION public.admissions_report(p_account_id uuid, p_from timestamptz, p_to timestamptz, p_campus_id uuid DEFAULT NULL)
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
      FROM l WHERE admitted_at IS NOT NULL AND imported_at IS NULL),
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
