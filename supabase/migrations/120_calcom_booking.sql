-- 120 — M5 booking (#68, ADR 0030): what a Cal.com webhook does to visits and the lead, and the visit reminders.
--
-- The webhook (src/app/api/admissions/calcom) verifies Cal.com's signature, then calls one of these. Each runs in one
-- transaction and is safe to replay: a booking id already seen, or a visit already cancelled / no-show, changes nothing.
-- Server only (service role): RLS is not the guard here, the webhook signature is.
--
-- Reminders run from wacrm's automations cron, like the M6 follow-ups (ADR 0028): claim_visit_reminders reads the
-- booked visits on every run, so a reschedule or cancel needs nothing unqueued. The three stamps make each reminder once.
-- (CREATE OR REPLACE / IF NOT EXISTS so the shared local DB can take a re-applied 120.)

ALTER TABLE public.visits
  ADD COLUMN IF NOT EXISTS rsvp_sent_at     timestamptz,  -- the T-24h "coming?" message was claimed
  ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz,  -- the morning-of-the-visit reminder was claimed
  ADD COLUMN IF NOT EXISTS call_task_at     timestamptz;  -- no reply to the RSVP: a call task was made

-- The lead's "Visit booked" stage, and the stage it is in now, with their positions. Visit booked is the pipeline's
-- second stage by position, as 113 takes Admitted to be the last: stage names change in Pipeline, the order doesn't.
CREATE OR REPLACE FUNCTION public.visit_booked_stage(p_lead_id uuid, OUT stage_id uuid, OUT stage_pos int, OUT current_pos int)
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

-- Which open lead a booking is for (ADR 0030 §3), in order:
--   1. the lead of the booking a reschedule replaces;
--   2. the lead id our booking link carried, if the booking's phone (when it has one) is that lead's parent's phone;
--   3. by phone: the open leads with those digits, if all in one account (siblings: the most recent lead).
-- Null when none, or when the phone has open leads in two accounts. An Indian +91 number also matches its 10 digits
-- without 91, as the sheet import stores them (116/117).
CREATE OR REPLACE FUNCTION public.calcom_lead(p_lead_id uuid, p_phone text, p_from_booking text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql STABLE
SET search_path = public
AS $$
DECLARE
  v_digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_alt text;
  v_lead uuid;
BEGIN
  v_alt := CASE WHEN v_digits ~ '^91[0-9]{10}$' THEN substr(v_digits, 3) END;

  SELECT l.id INTO v_lead FROM visits v JOIN leads l ON l.id = v.lead_id
  WHERE v.cal_booking_id = p_from_booking AND l.exit IS NULL AND l.admitted_at IS NULL;
  IF v_lead IS NOT NULL THEN RETURN v_lead; END IF;

  SELECT l.id INTO v_lead FROM leads l JOIN contacts c ON c.id = l.contact_id
  WHERE l.id = p_lead_id AND l.exit IS NULL AND l.admitted_at IS NULL
    AND (v_digits = '' OR c.phone_normalized IN (v_digits, v_alt));
  IF v_lead IS NOT NULL OR v_digits !~ '^\d{8,15}$' THEN RETURN v_lead; END IF;

  WITH m AS (
    SELECT l.id, l.account_id, l.created_at FROM leads l JOIN contacts c ON c.id = l.contact_id
    WHERE l.exit IS NULL AND l.admitted_at IS NULL AND c.phone_normalized IN (v_digits, v_alt)
  )
  SELECT m.id INTO v_lead FROM m
  WHERE (SELECT count(DISTINCT m2.account_id) FROM m m2) = 1
  ORDER BY m.created_at DESC, m.id DESC LIMIT 1;
  RETURN v_lead;
END $$;

-- BOOKING_CREATED / BOOKING_RESCHEDULED. Records the visit for calcom_lead's lead, marks the replaced one rescheduled,
-- and moves a lead still before Visit booked to it. A booking id seen before (even only as a cancel) changes nothing.
-- Returns the lead and who to message, or no row when nothing was recorded.
CREATE OR REPLACE FUNCTION public.calcom_book(
  p_booking text, p_starts_at timestamptz, p_lead_id uuid, p_phone text, p_from_booking text DEFAULT NULL
) RETURNS TABLE (lead_id uuid, account_id uuid, contact_id uuid, owner_id uuid)
LANGUAGE plpgsql
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_lead uuid;
  v_stage record;
BEGIN
  IF EXISTS (SELECT 1 FROM visits v WHERE v.cal_booking_id = p_booking) THEN RETURN; END IF;
  v_lead := calcom_lead(p_lead_id, p_phone, p_from_booking);
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
-- to the latest stage it was in that comes before Visit booked (G5.2); never the last stage, so never Admitted.
-- A cancel that arrives before its booking is stored as a cancelled visit, so the late booking changes nothing.
-- Returns the lead, or null when nothing changed.
CREATE OR REPLACE FUNCTION public.calcom_cancel(p_booking text, p_starts_at timestamptz, p_lead_id uuid, p_phone text)
RETURNS uuid
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

  IF v_lead IS NULL THEN
    IF p_starts_at IS NULL OR EXISTS (SELECT 1 FROM visits v WHERE v.cal_booking_id = p_booking) THEN RETURN NULL; END IF;
    v_lead := calcom_lead(p_lead_id, p_phone);
    IF v_lead IS NULL THEN RETURN NULL; END IF;
    INSERT INTO visits (account_id, lead_id, cal_booking_id, starts_at, campus_id, status)
    SELECT l.account_id, l.id, p_booking, p_starts_at, l.campus_id, 'cancelled' FROM leads l WHERE l.id = v_lead
    ON CONFLICT (cal_booking_id) DO NOTHING;
    RETURN CASE WHEN FOUND THEN v_lead END;
  END IF;

  SELECT * INTO v_stage FROM visit_booked_stage(v_lead);
  IF v_stage.current_pos = v_stage.stage_pos
     AND EXISTS (SELECT 1 FROM leads l WHERE l.id = v_lead AND l.exit IS NULL AND l.admitted_at IS NULL)
     AND NOT EXISTS (SELECT 1 FROM visits v WHERE v.lead_id = v_lead AND v.status = 'booked') THEN
    SELECT h.stage_id INTO v_back
    FROM lead_stage_history h
    JOIN pipeline_stages s ON s.id = h.stage_id
    JOIN leads l ON l.id = h.lead_id
    JOIN deals d ON d.id = l.deal_id AND d.pipeline_id = s.pipeline_id
    WHERE h.lead_id = v_lead AND s.position < v_stage.stage_pos
      AND s.position < (SELECT max(ps.position) FROM pipeline_stages ps WHERE ps.pipeline_id = s.pipeline_id)
    ORDER BY h.entered_at DESC, h.id DESC LIMIT 1;
    IF v_back IS NOT NULL THEN PERFORM move_lead(v_lead, v_back); END IF;
  END IF;
  RETURN v_lead;
END $$;

-- BOOKING_NO_SHOW_UPDATED (marked). Marks a booked visit of an open lead no-show and makes one call task to rebook
-- (brief §6). Returns who to send the rebook message to, or no row when nothing changed.
CREATE OR REPLACE FUNCTION public.calcom_no_show(p_booking text)
RETURNS TABLE (lead_id uuid, account_id uuid, contact_id uuid, owner_id uuid)
LANGUAGE plpgsql
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_lead uuid;
BEGIN
  UPDATE visits v SET status = 'no_show' FROM leads l
  WHERE l.id = v.lead_id AND l.exit IS NULL AND l.admitted_at IS NULL
    AND v.cal_booking_id = p_booking AND v.status = 'booked'
  RETURNING v.lead_id INTO v_lead;
  IF v_lead IS NULL THEN RETURN; END IF;

  INSERT INTO lead_activity (account_id, lead_id, kind, notes)
  SELECT l.account_id, l.id, 'call_task', 'Missed the visit: call to rebook' FROM leads l WHERE l.id = v_lead;

  RETURN QUERY SELECT l.id, l.account_id, l.contact_id, a.owner_user_id
  FROM leads l JOIN accounts a ON a.id = l.account_id WHERE l.id = v_lead;
END $$;

-- A clock time in India on the visit's India day, plus p_days days.
CREATE OR REPLACE FUNCTION public.ist_on_visit_day(p_starts_at timestamptz, p_days int, p_time time) RETURNS timestamptz
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
-- At most 50 of each per run, soonest visit first (as 118); the rest go on the next run. Each claim locks its rows and
-- skips rows another run holds, so overlapping runs never claim the same visit. Returns the template sends.
-- shortcut: times and template names are fixed here, not in Settings; move them to Settings when Nimish wants to edit them.
CREATE OR REPLACE FUNCTION public.claim_visit_reminders(p_now timestamptz DEFAULT now())
RETURNS TABLE (visit_id uuid, account_id uuid, contact_id uuid, owner_id uuid, template text)
LANGUAGE plpgsql
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT v.id FROM visits v JOIN leads l ON l.id = v.lead_id
    WHERE l.exit IS NULL AND l.admitted_at IS NULL AND v.status = 'booked' AND v.starts_at > p_now
      AND v.rsvp_sent_at IS NULL
      AND p_now >= v.starts_at - interval '24 hours' AND v.created_at < v.starts_at - interval '24 hours'
    ORDER BY v.starts_at, v.id LIMIT 50
    FOR UPDATE OF v SKIP LOCKED
  ), s AS (
    UPDATE visits v SET rsvp_sent_at = p_now FROM due, leads l WHERE v.id = due.id AND l.id = v.lead_id
    RETURNING v.id, v.account_id, l.contact_id
  ) SELECT s.id, s.account_id, s.contact_id, a.owner_user_id, 'visit_rsvp_24h'::text FROM s JOIN accounts a ON a.id = s.account_id;

  RETURN QUERY
  WITH due AS (
    SELECT v.id FROM visits v JOIN leads l ON l.id = v.lead_id
    WHERE l.exit IS NULL AND l.admitted_at IS NULL AND v.status = 'booked' AND v.starts_at > p_now
      AND v.reminder_sent_at IS NULL
      AND p_now >= ist_on_visit_day(v.starts_at, 0, '08:00') AND v.created_at < ist_on_visit_day(v.starts_at, 0, '08:00')
    ORDER BY v.starts_at, v.id LIMIT 50
    FOR UPDATE OF v SKIP LOCKED
  ), s AS (
    UPDATE visits v SET reminder_sent_at = p_now FROM due, leads l WHERE v.id = due.id AND l.id = v.lead_id
    RETURNING v.id, v.account_id, l.contact_id
  ) SELECT s.id, s.account_id, s.contact_id, a.owner_user_id, 'visit_reminder_morning'::text
    FROM s JOIN accounts a ON a.id = s.account_id;

  WITH due AS (
    SELECT v.id FROM visits v JOIN leads l ON l.id = v.lead_id
    WHERE l.exit IS NULL AND l.admitted_at IS NULL AND v.status = 'booked' AND v.starts_at > p_now
      AND v.call_task_at IS NULL AND v.rsvp_sent_at IS NOT NULL
      AND p_now >= GREATEST(ist_on_visit_day(v.starts_at, -1, '18:00'), v.rsvp_sent_at + interval '2 hours')
      AND NOT EXISTS (SELECT 1 FROM conversations c
                      WHERE c.account_id = v.account_id AND c.contact_id = l.contact_id
                        AND c.last_inbound_at > v.rsvp_sent_at)
    ORDER BY v.starts_at, v.id LIMIT 50
    FOR UPDATE OF v SKIP LOCKED
  ), s AS (
    UPDATE visits v SET call_task_at = p_now FROM due WHERE v.id = due.id
    RETURNING v.account_id, v.lead_id
  )
  INSERT INTO lead_activity (account_id, lead_id, kind, due_at, notes)
  SELECT s.account_id, s.lead_id, 'call_task', p_now, 'Visit not confirmed: call before the visit' FROM s;
END $$;

REVOKE ALL ON FUNCTION public.visit_booked_stage(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.calcom_lead(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ist_on_visit_day(timestamptz, int, time) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.calcom_book(text, timestamptz, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.calcom_cancel(text, timestamptz, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.calcom_no_show(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_visit_reminders(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.visit_booked_stage(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.calcom_lead(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.calcom_book(text, timestamptz, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.calcom_cancel(text, timestamptz, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.calcom_no_show(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_visit_reminders(timestamptz) TO service_role;
