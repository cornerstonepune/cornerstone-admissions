-- 118 — M6 follow-ups review fixes (#87 review, ADR 0028 §9). claim_due_follow_ups as 115, plus:
--   a. An imported lead (117, imported_at) gets no follow-up from the stage entry the import made; a stage move by a
--      person makes a new entry and starts them again.
--   b. No catch-up burst. Per stage entry only the latest due day fires (the rules with the most days among those due);
--      earlier due rules are passed over for good. A due Dormant rule wins: the lead closes and nothing else is made
--      or sent for it.
--   c. At most 50 follow-ups per run, oldest stage entry first; the next run takes the rest. Follow-ups already made
--      are left out before the cut, so they never crowd out new ones.
CREATE OR REPLACE FUNCTION public.claim_due_follow_ups(p_now timestamptz DEFAULT now())
RETURNS TABLE (activity_id uuid, account_id uuid, contact_id uuid, owner_id uuid, template text)
LANGUAGE sql
SET search_path = public
AS $$
  WITH due AS (
    SELECT l.id AS lead_id, l.account_id, l.contact_id, s.id AS rule_id, h.id AS entry_id, h.entered_at,
           (s.value->>'days')::int AS days, s.value->>'action' AS action, s.value->>'template' AS template
    FROM leads l
    JOIN LATERAL (
      SELECT id, stage_id, entered_at FROM lead_stage_history
      WHERE lead_id = l.id ORDER BY entered_at DESC, id DESC LIMIT 1
    ) h ON true
    JOIN admissions_settings s
      ON s.account_id = l.account_id AND s.kind = 'follow_up_rule' AND s.active
     AND s.value->>'stage' = h.stage_id::text
    WHERE l.exit IS NULL AND l.admitted_at IS NULL
      AND NOT (l.imported_at IS NOT NULL AND h.entered_at <= l.imported_at)
      AND (p_now AT TIME ZONE 'Asia/Kolkata')::date - (h.entered_at AT TIME ZONE 'Asia/Kolkata')::date
          >= (s.value->>'days')::int
      AND NOT EXISTS (
        SELECT 1 FROM conversations c
        WHERE c.account_id = l.account_id AND c.contact_id = l.contact_id AND c.last_inbound_at > h.entered_at)
  ),
  ranked AS (
    SELECT *, bool_or(action = 'dormant') OVER w AS closes, max(days) OVER w AS top
    FROM due WINDOW w AS (PARTITION BY lead_id, entry_id)
  ),
  todo AS (
    SELECT * FROM ranked r
    WHERE (CASE WHEN r.closes THEN r.action = 'dormant' ELSE r.days = r.top END)
      AND NOT EXISTS (
        SELECT 1 FROM lead_activity a
        WHERE a.lead_id = r.lead_id AND a.rule_id = r.rule_id AND a.stage_history_id = r.entry_id)
    ORDER BY r.entered_at, r.lead_id, r.rule_id
    LIMIT 50
  ),
  dormant AS (
    UPDATE leads l SET exit = 'dormant', exited_at = p_now
    FROM todo WHERE todo.lead_id = l.id AND todo.action = 'dormant'
    RETURNING l.id
  ),
  made AS (
    INSERT INTO lead_activity (account_id, lead_id, kind, rule_id, stage_history_id, due_at)
    SELECT account_id, lead_id,
           (CASE action WHEN 'send_template' THEN 'follow_up_send' ELSE 'call_task' END)::lead_activity_kind,
           rule_id, entry_id, p_now
    FROM todo WHERE action IN ('send_template', 'call_task')
    ON CONFLICT (lead_id, rule_id, stage_history_id) WHERE rule_id IS NOT NULL DO NOTHING
    RETURNING id, lead_id, rule_id, kind
  )
  SELECT m.id, d.account_id, d.contact_id, a.owner_user_id, d.template
  FROM made m
  JOIN todo d ON d.lead_id = m.lead_id AND d.rule_id = m.rule_id
  JOIN accounts a ON a.id = d.account_id
  WHERE m.kind = 'follow_up_send'
$$;
