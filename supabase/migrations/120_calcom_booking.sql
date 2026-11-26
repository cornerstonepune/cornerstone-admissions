-- 120 — M5 booking (#68, ADR 0030): what a Cal.com webhook does to visits and the lead, and the visit reminders.
--
-- The webhook (src/app/api/admissions/calcom) verifies Cal.com's signature, then calls one of these. Each runs in one
-- transaction and is safe to replay: a booking id already seen, or a visit already cancelled / no-show, changes nothing.
-- Server only (service role): RLS is not the guard here, the webhook signature is.
--
-- Reminders run from wacrm's automations cron, like the M6 follow-ups (ADR 0028): claim_visit_reminders reads the
-- booked visits on every run, so a reschedule or cancel needs nothing unqueued. The three stamps make each reminder once.

ALTER TABLE public.visits
  ADD COLUMN rsvp_sent_at     timestamptz,  -- the T-24h "coming?" message was claimed
  ADD COLUMN reminder_sent_at timestamptz,  -- the morning-of-the-visit reminder was claimed
  ADD COLUMN call_task_at     timestamptz;  -- no reply to the RSVP: a call task was made

-- The lead's "Visit booked" stage, and the stage it is in now, with their positions. Visit booked is the pipeline's
-- second stage by position, as 113 takes Admitted to be the last: stage names change in Pipeline, the order doesn't.
CREATE FUNCTION public.visit_booked_stage(p_lead_id uuid, OUT stage_id uuid, OUT stage_pos int, OUT current_pos int)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT s.id, s.position, cur.position
  FROM leads l
  JOIN deals d ON d.id = l.deal_id
  JOIN pipeline_stages cur ON cur.id = d.stage_id
  JOIN LATERAL (
    SELECT ps.id, ps.position FROM pipeline_stages ps WHERE ps.pipeline_id = d.pipeline_id
    ORDER BY ps.position, ps.id OFFSET 1 LIMIT 1
  ) s ON true
  WHERE l.id = p_lead_id
$$;

-- BOOKING_CREATED / BOOKING_RESCHEDULED. The lead is, in order: the lead of the booking this one replaces, the lead id
-- the booking link carried, or the one open lead whose parent's phone matches (none or several: nothing is written).
-- Records the visit, marks the replaced one rescheduled, and moves a lead still before Visit booked to it.
-- Returns the lead and who to message, or no row when nothing was recorded.
CREATE FUNCTION public.calcom_book(
  p_booking text, p_starts_at timestamptz, p_lead_id uuid, p_phone text, p_from_booking text DEFAULT NULL
) RETURNS TABLE (lead_id uuid, account_id uuid, contact_id uuid, owner_id uuid)
LANGUAGE plpgsql
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_lead uuid;
  v_ids uuid[];
  v_stage record;
BEGIN
  IF EXISTS (SELECT 1 FROM visits v WHERE v.cal_booking_id = p_booking) THEN RETURN; END IF;

  SELECT v.lead_id INTO v_lead FROM visits v WHERE v.cal_booking_id = p_from_booking;
  IF v_lead IS NULL THEN
    SELECT l.id INTO v_lead FROM leads l WHERE l.id = p_lead_id;
  END IF;
  IF v_lead IS NULL AND regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') ~ '^\d{8,15}$' THEN
    SELECT array_agg(l.id) INTO v_ids
    FROM leads l JOIN contacts c ON c.id = l.contact_id
    WHERE l.exit IS NULL AND l.admitted_at IS NULL
      AND regexp_replace(c.phone, '\D', '', 'g') = regexp_replace(p_phone, '\D', '', 'g');
    IF cardinality(v_ids) = 1 THEN v_lead := v_ids[1]; END IF;
  END IF;
  -- only an open lead books
  SELECT l.id INTO v_lead FROM leads l WHERE l.id = v_lead AND l.exit IS NULL AND l.admitted_at IS NULL;
  IF v_lead IS NULL THEN RETURN; END IF;

  INSERT INTO visits (account_id, lead_id, cal_booking_id, starts_at, campus_id)
  SELECT l.account_id, l.id, p_booking, p_starts_at, l.campus_id FROM leads l WHERE l.id = v_lead
  ON CONFLICT (cal_booking_id) DO NOTHING;
  IF NOT FOUND THEN RETURN; END IF;  -- the same booking, in a webhook delivered twice at once

  UPDATE visits v SET status = 'rescheduled'
  WHERE v.cal_booking_id = p_from_booking AND v.lead_id = v_lead AND v.status = 'booked';

  SELECT * INTO v_stage FROM visit_booked_stage(v_lead);
  IF v_stage.current_pos < v_stage.stage_pos THEN
    PERFORM move_lead(v_lead, v_stage.stage_id);
  END IF;

  RETURN QUERY SELECT l.id, l.account_id, l.contact_id, a.owner_user_id
  FROM leads l JOIN accounts a ON a.id = l.account_id WHERE l.id = v_lead;
END $$;

-- BOOKING_CANCELLED. Marks a booked visit cancelled. A lead still in Visit booked with no other booked visit goes back
-- to the stage it was in before (G5.2). Returns the lead, or null when nothing changed.
CREATE FUNCTION public.calcom_cancel(p_booking text) RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_lead uuid;
  v_stage record;
  v_back uuid;
BEGIN
  UPDATE visits v SET status = 'cancelled' WHERE v.cal_booking_id = p_booking AND v.status = 'booked'
  RETURNING v.lead_id INTO v_lead;
  IF v_lead IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO v_stage FROM visit_booked_stage(v_lead);
  IF v_stage.current_pos = v_stage.stage_pos
     AND EXISTS (SELECT 1 FROM leads l WHERE l.id = v_lead AND l.exit IS NULL AND l.admitted_at IS NULL)
     AND NOT EXISTS (SELECT 1 FROM visits v WHERE v.lead_id = v_lead AND v.status = 'booked') THEN
    SELECT h.stage_id INTO v_back FROM lead_stage_history h
    WHERE h.lead_id = v_lead ORDER BY h.entered_at DESC, h.id DESC OFFSET 1 LIMIT 1;
    IF v_back IS NOT NULL THEN PERFORM move_lead(v_lead, v_back); END IF;
  END IF;
  RETURN v_lead;
END $$;

-- BOOKING_NO_SHOW_UPDATED (marked). Marks a booked visit no-show and makes one call task to rebook (brief §6).
-- Returns who to send the rebook message to, or no row when nothing changed.
CREATE FUNCTION public.calcom_no_show(p_booking text)
RETURNS TABLE (lead_id uuid, account_id uuid, contact_id uuid, owner_id uuid)
LANGUAGE plpgsql
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_lead uuid;
BEGIN
  UPDATE visits v SET status = 'no_show' WHERE v.cal_booking_id = p_booking AND v.status = 'booked'
  RETURNING v.lead_id INTO v_lead;
  IF v_lead IS NULL THEN RETURN; END IF;

  INSERT INTO lead_activity (account_id, lead_id, kind, notes)
  SELECT l.account_id, l.id, 'call_task', 'Missed the visit: call to rebook' FROM leads l WHERE l.id = v_lead;

  RETURN QUERY SELECT l.id, l.account_id, l.contact_id, a.owner_user_id
  FROM leads l JOIN accounts a ON a.id = l.account_id WHERE l.id = v_lead;
END $$;

-- A clock time in India on the visit's India day, plus p_days days.
CREATE FUNCTION public.ist_on_visit_day(p_starts_at timestamptz, p_days int, p_time time) RETURNS timestamptz
LANGUAGE sql IMMUTABLE
AS $$
  SELECT (((p_starts_at AT TIME ZONE 'Asia/Kolkata')::date + p_days) + p_time) AT TIME ZONE 'Asia/Kolkata'
$$;

-- The visit reminders due now, each claimed once (India time, brief §6):
--   visit_rsvp_24h          24 hours before the visit;
--   visit_reminder_morning  08:00 on the visit day;
--   a call task             the parent hasn't written since the RSVP by 18:00 the evening before (or 2 hours after a
--                           late RSVP), so the Today list shows who to call (G5.3).
-- Only for booked visits still ahead of an open lead, and never for a moment already past when the visit was booked.
-- Separate statements, so one visit can be due for several at once; a concurrent run waits on the row lock, then sees
-- the stamp. Returns the template sends.
-- shortcut: times and template names are fixed here, not in Settings; move them to Settings when Nimish wants to edit them.
CREATE FUNCTION public.claim_visit_reminders(p_now timestamptz DEFAULT now())
RETURNS TABLE (visit_id uuid, account_id uuid, contact_id uuid, owner_id uuid, template text)
LANGUAGE plpgsql
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH s AS (
    UPDATE visits v SET rsvp_sent_at = p_now FROM leads l
    WHERE l.id = v.lead_id AND l.exit IS NULL AND l.admitted_at IS NULL AND v.status = 'booked' AND v.starts_at > p_now
      AND v.rsvp_sent_at IS NULL
      AND p_now >= v.starts_at - interval '24 hours' AND v.created_at < v.starts_at - interval '24 hours'
    RETURNING v.id, v.account_id, l.contact_id
  ) SELECT s.id, s.account_id, s.contact_id, a.owner_user_id, 'visit_rsvp_24h'::text FROM s JOIN accounts a ON a.id = s.account_id;

  RETURN QUERY
  WITH s AS (
    UPDATE visits v SET reminder_sent_at = p_now FROM leads l
    WHERE l.id = v.lead_id AND l.exit IS NULL AND l.admitted_at IS NULL AND v.status = 'booked' AND v.starts_at > p_now
      AND v.reminder_sent_at IS NULL
      AND p_now >= ist_on_visit_day(v.starts_at, 0, '08:00') AND v.created_at < ist_on_visit_day(v.starts_at, 0, '08:00')
    RETURNING v.id, v.account_id, l.contact_id
  ) SELECT s.id, s.account_id, s.contact_id, a.owner_user_id, 'visit_reminder_morning'::text
    FROM s JOIN accounts a ON a.id = s.account_id;

  WITH s AS (
    UPDATE visits v SET call_task_at = p_now FROM leads l
    WHERE l.id = v.lead_id AND l.exit IS NULL AND l.admitted_at IS NULL AND v.status = 'booked' AND v.starts_at > p_now
      AND v.call_task_at IS NULL AND v.rsvp_sent_at IS NOT NULL
      AND p_now >= GREATEST(ist_on_visit_day(v.starts_at, -1, '18:00'), v.rsvp_sent_at + interval '2 hours')
      AND NOT EXISTS (SELECT 1 FROM conversations c
                      WHERE c.account_id = v.account_id AND c.contact_id = l.contact_id
                        AND c.last_inbound_at > v.rsvp_sent_at)
    RETURNING v.account_id, v.lead_id
  )
  INSERT INTO lead_activity (account_id, lead_id, kind, due_at, notes)
  SELECT s.account_id, s.lead_id, 'call_task', p_now, 'Visit not confirmed: call before the visit' FROM s;
END $$;

REVOKE ALL ON FUNCTION public.visit_booked_stage(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ist_on_visit_day(timestamptz, int, time) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.calcom_book(text, timestamptz, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.calcom_cancel(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.calcom_no_show(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_visit_reminders(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.visit_booked_stage(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.calcom_book(text, timestamptz, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.calcom_cancel(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.calcom_no_show(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_visit_reminders(timestamptz) TO service_role;
