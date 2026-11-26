-- 128 — Meetings on a calendar (ADR 0040).
-- A visit row is now any meeting with a family: a campus visit, a video call or a phone call. Cal.com still makes most
-- of them (calcom_book, now told the kind and the video link); staff add the rest while logging a call (book_meeting).
-- Every booked meeting gets the same WhatsApp reminders (claim_visit_reminders reads all booked rows, unchanged).

ALTER TABLE public.visits ALTER COLUMN cal_booking_id DROP NOT NULL;  -- a meeting staff add has no Cal.com booking
ALTER TABLE public.visits
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'campus' CHECK (kind IN ('campus', 'virtual', 'phone')),
  ADD COLUMN IF NOT EXISTS meeting_url text,  -- a video call's link
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;  -- null: Cal.com made it
ALTER TABLE public.visits DROP CONSTRAINT IF EXISTS visits_meeting_url_check;
ALTER TABLE public.visits ADD CONSTRAINT visits_meeting_url_check
  CHECK (meeting_url IS NULL OR (kind = 'virtual' AND length(meeting_url) <= 500 AND meeting_url ~ '^https://[^[:space:]]+$'));

CREATE INDEX IF NOT EXISTS visits_account_starts_idx ON public.visits (account_id, starts_at);
-- One staff-booked meeting per lead per moment: two saves at once (a double click) book and confirm it once.
-- Cal.com rows stay outside it: 120 lets two bookings share a time, each with its own booking id.
CREATE UNIQUE INDEX IF NOT EXISTS visits_one_staff_meeting_per_time ON public.visits (lead_id, starts_at)
  WHERE status = 'booked' AND cal_booking_id IS NULL;

-- Who booked it is whoever is signed in, never what a client sends (Cal.com's rows run with no user: null).
CREATE OR REPLACE FUNCTION public.visits_set_created_by() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.created_by := auth.uid();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS visits_set_created_by ON public.visits;
CREATE TRIGGER visits_set_created_by BEFORE INSERT ON public.visits FOR EACH ROW EXECUTE FUNCTION public.visits_set_created_by();
REVOKE ALL ON FUNCTION public.visits_set_created_by() FROM PUBLIC, anon, authenticated;

-- Staff book a meeting for an open lead. Runs as the caller, so RLS on leads, visits and deals is the tenancy guard;
-- the membership check only turns a viewer's attempt into a clear 42501. The same lead at the same moment is one
-- meeting (a retried save books nothing twice). Like a Cal.com booking, it moves a lead before Visit booked to it.
CREATE OR REPLACE FUNCTION public.book_meeting(
  p_lead_id uuid, p_starts_at timestamptz, p_kind text, p_campus_id uuid DEFAULT NULL, p_url text DEFAULT NULL
) RETURNS TABLE (visit_id uuid, created boolean, account_id uuid, contact_id uuid, owner_id uuid)
LANGUAGE plpgsql
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_lead record;
  v_campus uuid;
  v_id uuid;
  v_stage record;
BEGIN
  SELECT l.id, l.account_id, l.contact_id, l.campus_id INTO v_lead FROM leads l
  WHERE l.id = p_lead_id AND l.exit IS NULL AND l.admitted_at IS NULL;
  IF v_lead.id IS NULL THEN
    RAISE EXCEPTION 'Only an open lead can have a meeting booked' USING ERRCODE = '23514';
  END IF;
  IF NOT is_account_member(v_lead.account_id, 'agent') THEN
    RAISE EXCEPTION 'You cannot book meetings' USING ERRCODE = '42501';
  END IF;
  IF p_starts_at IS NULL OR p_kind IS NULL OR p_kind NOT IN ('campus', 'virtual', 'phone') THEN
    RAISE EXCEPTION 'A meeting needs a time and a kind' USING ERRCODE = '23514';
  END IF;
  IF p_campus_id IS NOT NULL THEN
    SELECT s.id INTO v_campus FROM admissions_settings s
    WHERE s.id = p_campus_id AND s.account_id = v_lead.account_id AND s.kind = 'campus' AND s.active;
    IF v_campus IS NULL THEN RAISE EXCEPTION 'Not a campus of this account' USING ERRCODE = '23514'; END IF;
  END IF;

  -- already booked at this moment (Cal.com, or a retried save): the same meeting, not created
  SELECT v.id INTO v_id FROM visits v
  WHERE v.lead_id = v_lead.id AND v.starts_at = p_starts_at AND v.status = 'booked' ORDER BY v.created_at LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO visits (account_id, lead_id, starts_at, campus_id, kind, meeting_url)
    VALUES (v_lead.account_id, v_lead.id, p_starts_at, coalesce(v_campus, v_lead.campus_id), p_kind,
            CASE WHEN p_kind = 'virtual' THEN nullif(btrim(p_url), '') END)
    ON CONFLICT (lead_id, starts_at) WHERE status = 'booked' AND cal_booking_id IS NULL DO NOTHING  -- a double save
    RETURNING id INTO v_id;
    IF v_id IS NOT NULL THEN
      SELECT * INTO v_stage FROM visit_booked_stage(v_lead.id);
      IF v_stage.current_pos < v_stage.stage_pos THEN
        PERFORM move_lead(v_lead.id, v_stage.stage_id);
      END IF;
      RETURN QUERY SELECT v_id, true, v_lead.account_id, v_lead.contact_id, a.owner_user_id
        FROM accounts a WHERE a.id = v_lead.account_id;
      RETURN;
    END IF;
    SELECT v.id INTO v_id FROM visits v
    WHERE v.lead_id = v_lead.id AND v.starts_at = p_starts_at AND v.status = 'booked' AND v.cal_booking_id IS NULL;
  END IF;
  IF v_id IS NOT NULL THEN
    RETURN QUERY SELECT v_id, false, v_lead.account_id, v_lead.contact_id, a.owner_user_id
      FROM accounts a WHERE a.id = v_lead.account_id;
  END IF;
END $$;

-- calcom_book as 122, plus the kind and the video link Cal.com sent.
DROP FUNCTION IF EXISTS public.calcom_book(text, timestamptz, uuid, text, text, text);
CREATE OR REPLACE FUNCTION public.calcom_book(
  p_booking text, p_starts_at timestamptz, p_lead_id uuid, p_phone text, p_from_booking text DEFAULT NULL,
  p_location text DEFAULT NULL, p_kind text DEFAULT 'campus', p_url text DEFAULT NULL
) RETURNS TABLE (lead_id uuid, account_id uuid, contact_id uuid, owner_id uuid)
LANGUAGE plpgsql
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_lead uuid;
  v_campus uuid;
  v_stage record;
BEGIN
  IF EXISTS (SELECT 1 FROM visits v WHERE v.cal_booking_id = p_booking) THEN RETURN; END IF;
  v_lead := calcom_lead(p_lead_id, p_phone, p_from_booking);
  IF v_lead IS NULL THEN RETURN; END IF;
  v_campus := calcom_campus((SELECT l.account_id FROM leads l WHERE l.id = v_lead), p_location);

  INSERT INTO visits (account_id, lead_id, cal_booking_id, starts_at, campus_id, kind, meeting_url)
  SELECT l.account_id, l.id, p_booking, p_starts_at, coalesce(v_campus, l.campus_id),
         CASE WHEN p_kind IN ('campus', 'virtual', 'phone') THEN p_kind ELSE 'campus' END,
         CASE WHEN p_kind = 'virtual' THEN p_url END
  FROM leads l WHERE l.id = v_lead
  ON CONFLICT (cal_booking_id) DO NOTHING;
  IF NOT FOUND THEN RETURN; END IF;  -- the same booking, in a webhook delivered twice at once

  IF v_campus IS NOT NULL THEN
    UPDATE leads l SET campus_id = v_campus WHERE l.id = v_lead AND l.campus_id IS NULL;
  END IF;

  UPDATE visits v SET status = 'rescheduled'
  WHERE v.cal_booking_id = p_from_booking AND v.lead_id = v_lead AND v.status = 'booked';

  SELECT * INTO v_stage FROM visit_booked_stage(v_lead);
  IF v_stage.current_pos < v_stage.stage_pos THEN
    PERFORM move_lead(v_lead, v_stage.stage_id);
  END IF;

  RETURN QUERY SELECT l.id, l.account_id, l.contact_id, a.owner_user_id
  FROM leads l JOIN accounts a ON a.id = l.account_id WHERE l.id = v_lead;
END $$;

-- Hosted Supabase grants new functions to anon and authenticated by default: state every grant from zero.
REVOKE ALL ON FUNCTION public.book_meeting(uuid, timestamptz, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.book_meeting(uuid, timestamptz, text, uuid, text) TO authenticated, service_role;
-- book_meeting runs as staff and reads the stage through it; it only reads, under the caller's RLS.
GRANT EXECUTE ON FUNCTION public.visit_booked_stage(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.calcom_book(text, timestamptz, uuid, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calcom_book(text, timestamptz, uuid, text, text, text, text, text) TO service_role;
