-- 115 — M6 follow-ups (#69, ADR 0027): wacrm's cron claims each due follow-up once, here, in one statement.
--
-- A follow-up is due when an open lead's current stage entry is in an active rule's stage and the rule's days have
-- passed (India calendar days, as days_in_stage counts them). The rule is read on every run, so a changed day count or a
-- rule switched off takes effect on the next run. A message from the parent since the lead entered the stage pauses its
-- follow-ups until it moves stage (GLOSSARY: Follow-up).
--   send_template → a follow_up_send row, returned so the cron sends it (and records the message on it);
--   call_task     → a call_task row (the Today list shows it);
--   dormant       → the lead closes as Dormant (no activity row, ADR 0017).
-- The duplicate guard is invariant 6 (lead_activity_one_per_rule_entry): ON CONFLICT DO NOTHING, so a second run, or two
-- runs at once, claim nothing more. Claimed before sending: a failed send is recorded, never retried, never doubled.
CREATE FUNCTION public.claim_due_follow_ups(p_now timestamptz DEFAULT now())
RETURNS TABLE (activity_id uuid, account_id uuid, contact_id uuid, owner_id uuid, template text)
LANGUAGE sql
SET search_path = public
AS $$
  WITH due AS (
    SELECT l.id AS lead_id, l.account_id, l.contact_id, s.id AS rule_id, h.id AS entry_id,
           s.value->>'action' AS action, s.value->>'template' AS template
    FROM leads l
    JOIN LATERAL (
      SELECT id, stage_id, entered_at FROM lead_stage_history
      WHERE lead_id = l.id ORDER BY entered_at DESC, id DESC LIMIT 1
    ) h ON true
    JOIN admissions_settings s
      ON s.account_id = l.account_id AND s.kind = 'follow_up_rule' AND s.active
     AND s.value->>'stage' = h.stage_id::text
    WHERE l.exit IS NULL AND l.admitted_at IS NULL
      AND (p_now AT TIME ZONE 'Asia/Kolkata')::date - (h.entered_at AT TIME ZONE 'Asia/Kolkata')::date
          >= (s.value->>'days')::int
      AND NOT EXISTS (
        SELECT 1 FROM conversations c
        WHERE c.account_id = l.account_id AND c.contact_id = l.contact_id AND c.last_inbound_at > h.entered_at)
  ),
  dormant AS (
    UPDATE leads l SET exit = 'dormant', exited_at = p_now
    FROM due WHERE due.lead_id = l.id AND due.action = 'dormant'
    RETURNING l.id
  ),
  made AS (
    INSERT INTO lead_activity (account_id, lead_id, kind, rule_id, stage_history_id, due_at)
    SELECT account_id, lead_id,
           (CASE action WHEN 'send_template' THEN 'follow_up_send' ELSE 'call_task' END)::lead_activity_kind,
           rule_id, entry_id, p_now
    FROM due WHERE action IN ('send_template', 'call_task')
    ON CONFLICT (lead_id, rule_id, stage_history_id) WHERE rule_id IS NOT NULL DO NOTHING
    RETURNING id, lead_id, rule_id, kind
  )
  SELECT m.id, d.account_id, d.contact_id, a.owner_user_id, d.template
  FROM made m
  JOIN due d ON d.lead_id = m.lead_id AND d.rule_id = m.rule_id
  JOIN accounts a ON a.id = d.account_id
  WHERE m.kind = 'follow_up_send'
$$;

-- Only the server (the cron, with the service role) claims follow-ups.
REVOKE ALL ON FUNCTION public.claim_due_follow_ups(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_follow_ups(timestamptz) TO service_role;
