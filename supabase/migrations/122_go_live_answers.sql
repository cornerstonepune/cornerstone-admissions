-- 122 — Go-live answers (ADR 0033).
-- 1. The Cal.com booking's location picks the visit's campus. Parents book one visit event with two in-person
--    locations (Gurukul by default, or Neev); Cal.com sends the chosen one as `payload.location`. The campus whose label
--    appears in it (case-insensitive) is used when exactly one does; otherwise the lead's campus, as in 120. A booking
--    also fills a lead that has no campus yet. calcom_book and calcom_cancel gain p_location DEFAULT NULL, so a call
--    without it behaves as 120. The old signatures are dropped: a second overload would make 5-argument calls ambiguous.
-- 2. A repeat family notifies the office: when intake_lead writes a note on a family's open lead, every member of the
--    account (but the staff member who saved it) gets a 'repeat_family' notification. The note's own once-only check
--    makes the notification once only too.

-- 1. Cal.com location -> campus -------------------------------------------------------------------------------------

-- The account's active campus whose label is in the location text, when exactly one is; else null.
CREATE OR REPLACE FUNCTION public.calcom_campus(p_account_id uuid, p_location text) RETURNS uuid
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT CASE WHEN count(*) = 1 THEN (array_agg(s.id))[1] END
  FROM admissions_settings s
  WHERE s.account_id = p_account_id AND s.kind = 'campus' AND s.active
    AND strpos(lower(coalesce(p_location, '')), lower(btrim(s.label))) > 0
$$;

DROP FUNCTION IF EXISTS public.calcom_book(text, timestamptz, uuid, text, text);
DROP FUNCTION IF EXISTS public.calcom_cancel(text, timestamptz, uuid, text);

-- As 120, plus: the visit's campus from the location, and a lead with no campus gets it.
CREATE OR REPLACE FUNCTION public.calcom_book(
  p_booking text, p_starts_at timestamptz, p_lead_id uuid, p_phone text, p_from_booking text DEFAULT NULL,
  p_location text DEFAULT NULL
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

  INSERT INTO visits (account_id, lead_id, cal_booking_id, starts_at, campus_id)
  SELECT l.account_id, l.id, p_booking, p_starts_at, coalesce(v_campus, l.campus_id) FROM leads l WHERE l.id = v_lead
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

-- As 120, plus: a cancel stored before its booking takes the campus from the location (the lead is left as it is).
CREATE OR REPLACE FUNCTION public.calcom_cancel(
  p_booking text, p_starts_at timestamptz, p_lead_id uuid, p_phone text, p_location text DEFAULT NULL
) RETURNS uuid
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
    SELECT l.account_id, l.id, p_booking, p_starts_at, coalesce(calcom_campus(l.account_id, p_location), l.campus_id), 'cancelled'
    FROM leads l WHERE l.id = v_lead
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

REVOKE ALL ON FUNCTION public.calcom_campus(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.calcom_book(text, timestamptz, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.calcom_cancel(text, timestamptz, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calcom_campus(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.calcom_book(text, timestamptz, uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.calcom_cancel(text, timestamptz, uuid, text, text) TO service_role;

-- 2. Repeat family -> the office is notified ------------------------------------------------------------------------

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check CHECK (type IN ('conversation_assigned', 'repeat_family'));

-- One 'repeat_family' notification per member of the account, except whoever is signed in (they just saved it).
-- SECURITY DEFINER: staff quick-add runs intake_lead through RLS, and notifications has no insert policy. So a signed-in
-- caller must be an agent or up in the account (as quick-add needs), and the contact must be the account's.
-- It links the parent's WhatsApp conversation (one per contact and account), when there is one.
CREATE OR REPLACE FUNCTION public.notify_repeat_family(p_account_id uuid, p_contact_id uuid, p_body text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT is_account_member(p_account_id, 'agent') THEN
    RAISE EXCEPTION 'Not a member of this account' USING ERRCODE = '42501';
  END IF;
  INSERT INTO notifications (account_id, user_id, type, conversation_id, contact_id, actor_user_id, title, body)
  SELECT p_account_id, p.user_id, 'repeat_family',
         (SELECT cv.id FROM conversations cv WHERE cv.account_id = p_account_id AND cv.contact_id = c.id),
         c.id, auth.uid(), 'Repeat enquiry: ' || coalesce(nullif(btrim(c.name), ''), c.phone), p_body
  FROM contacts c JOIN profiles p ON p.account_id = c.account_id
  WHERE c.id = p_contact_id AND c.account_id = p_account_id AND p.user_id IS DISTINCT FROM auth.uid();
END $$;

ALTER FUNCTION public.notify_repeat_family(uuid, uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.notify_repeat_family(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notify_repeat_family(uuid, uuid, text) TO authenticated, service_role;

-- intake_lead as 121, plus the notification when the note is written.
CREATE OR REPLACE FUNCTION public.intake_lead(p_account_id uuid, p_lead jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  -- service_role has no auth.uid(); rows that need an author get the account owner, as wacrm's webhook does
  v_user uuid := coalesce(auth.uid(), (SELECT owner_user_id FROM accounts WHERE id = p_account_id));
  v_contact uuid := (p_lead->>'contact_id')::uuid;
  v_phone text := nullif(p_lead->>'phone', '');
  v_fill boolean := coalesce((p_lead->>'fill')::boolean, true);
  v_child text := nullif(p_lead->>'child', '');
  v_dob date := (p_lead->>'child_dob')::date;
  v_source uuid;
  v_source_label text;
  v_stage uuid;
  v_deal uuid;
  v_lead uuid;
  v_old leads%ROWTYPE;
  v_details text;
  v_note text;
  v_created boolean := false;
BEGIN
  IF v_contact IS NULL THEN
    IF v_phone IS NULL OR v_phone !~ '^[0-9]{8,15}$' THEN
      RAISE EXCEPTION 'A phone number is needed' USING ERRCODE = '22023';
    END IF;
    -- an Indian number also matches a contact saved without 91, exact first, as import_leads (117) and calcom_lead (120)
    SELECT id INTO v_contact FROM contacts
      WHERE account_id = p_account_id
        AND phone_normalized IN (v_phone, CASE WHEN v_phone ~ '^91[0-9]{10}$' THEN substr(v_phone, 3) END)
      ORDER BY phone_normalized = v_phone DESC LIMIT 1;
    IF v_contact IS NULL THEN
      BEGIN
        INSERT INTO contacts (user_id, account_id, phone, name)
          VALUES (v_user, p_account_id, '+' || v_phone, nullif(p_lead->>'parent', ''))
          RETURNING id INTO v_contact;
      EXCEPTION WHEN unique_violation THEN
        SELECT id INTO v_contact FROM contacts WHERE account_id = p_account_id AND phone_normalized = v_phone;
      END;
    END IF;
  ELSIF NOT EXISTS (SELECT 1 FROM contacts WHERE id = v_contact AND account_id = p_account_id) THEN
    RAISE EXCEPTION 'Unknown contact' USING ERRCODE = '23503';
  END IF;
  IF v_fill THEN
    UPDATE contacts SET name = p_lead->>'parent'
      WHERE id = v_contact AND coalesce(name, '') = '' AND coalesce(p_lead->>'parent', '') <> '';
  END IF;

  SELECT s.id, s.label INTO v_source, v_source_label
    FROM jsonb_array_elements_text(coalesce(p_lead->'source_keys', '[]')) WITH ORDINALITY AS k(key, n)
    JOIN admissions_settings s ON s.account_id = p_account_id AND s.kind = 'source' AND s.key = k.key AND s.active
    ORDER BY k.n LIMIT 1;

  SELECT id INTO v_lead FROM leads WHERE contact_id = v_contact AND exit IS NULL AND admitted_at IS NULL;
  IF v_lead IS NULL AND NOT coalesce((p_lead->>'reopen')::boolean, true)
     AND EXISTS (SELECT 1 FROM leads WHERE contact_id = v_contact) THEN
    RETURN jsonb_build_object('contact_id', v_contact, 'lead_id', NULL, 'created', false);
  END IF;

  IF v_lead IS NULL THEN
    SELECT s.id INTO v_stage FROM pipeline_stages s JOIN pipelines p ON p.id = s.pipeline_id
      WHERE p.account_id = p_account_id AND p.name = 'Admissions' ORDER BY s.position LIMIT 1;
    IF v_stage IS NULL THEN
      RAISE EXCEPTION 'The Admissions pipeline has no stages' USING ERRCODE = '23514';
    END IF;
    BEGIN
      INSERT INTO deals (user_id, account_id, pipeline_id, stage_id, contact_id, title)
        SELECT v_user, p_account_id, s.pipeline_id, s.id, v_contact,
               coalesce(v_child, (SELECT coalesce(nullif(name, ''), phone) FROM contacts WHERE id = v_contact))
        FROM pipeline_stages s WHERE s.id = v_stage
        RETURNING id INTO v_deal;
      INSERT INTO leads (account_id, deal_id, contact_id, child_name, child_dob, grade, campus_id, area, source_id)
        VALUES (p_account_id, v_deal, v_contact, v_child, v_dob,
                nullif(p_lead->>'grade', ''), (p_lead->>'campus_id')::uuid, nullif(p_lead->>'area', ''), v_source)
        RETURNING id INTO v_lead;
      v_created := true;
    EXCEPTION WHEN unique_violation THEN -- another door opened it a moment ago: use that one (the deal rolls back too)
      SELECT id INTO v_lead FROM leads WHERE contact_id = v_contact AND exit IS NULL AND admitted_at IS NULL;
    END;
  END IF;

  IF NOT v_created THEN
    SELECT * INTO v_old FROM leads WHERE id = v_lead;
    v_details := concat_ws(', ', 'child ' || v_child, 'born ' || to_char(v_dob, 'DD/MM/YYYY'),
                           'grade ' || nullif(p_lead->>'grade', ''), 'source ' || v_source_label);
    IF coalesce(p_lead->>'note', '') <> '' THEN
      v_note := p_lead->>'note' || CASE WHEN v_details <> '' THEN ' Submitted: ' || v_details || '.' ELSE '' END;
    ELSIF v_details <> '' AND ((v_child IS NOT NULL AND v_old.child_name IS NOT NULL AND v_child <> v_old.child_name)
                            OR (v_dob IS NOT NULL AND v_old.child_dob IS NOT NULL AND v_dob <> v_old.child_dob)) THEN
      v_note := 'Another enquiry on this number: ' || v_details || '.';
    END IF;
    IF v_note IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM contact_notes WHERE contact_id = v_contact AND note_text = v_note) THEN
      INSERT INTO contact_notes (contact_id, user_id, note_text, account_id)
        VALUES (v_contact, v_user, v_note, p_account_id);
      BEGIN
        PERFORM notify_repeat_family(p_account_id, v_contact, v_note);
      EXCEPTION WHEN OTHERS THEN -- as wacrm's 027: a failed notification never loses the enquiry
        RAISE WARNING 'repeat_family notification failed for contact %: %', v_contact, SQLERRM;
      END;
    END IF;
    IF v_fill THEN
      UPDATE leads SET
        child_name = coalesce(child_name, v_child),
        child_dob = coalesce(child_dob, v_dob),
        grade = coalesce(grade, nullif(p_lead->>'grade', '')),
        campus_id = coalesce(campus_id, (p_lead->>'campus_id')::uuid),
        area = coalesce(area, nullif(p_lead->>'area', '')),
        source_id = coalesce(source_id, v_source)
      WHERE id = v_lead;
    END IF;
  END IF;
  RETURN jsonb_build_object('contact_id', v_contact, 'lead_id', v_lead, 'created', v_created);
END $$;
