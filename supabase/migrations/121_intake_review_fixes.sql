-- 121 — M4 review fixes (#91 security review, ADR 0031 §Review fixes): intake_lead as 119, plus
-- 1. a switched-off source is never set (WhatsApp, the form and quick-add then leave the source empty);
-- 2. p_lead.fill = false (the public website form): a family already with us keeps its lead and contact exactly as
--    they are; the form only adds a note, so an anonymous form can't write a known family's fields;
-- 3. when the family already has an open lead, its note carries what was submitted (child, date of birth, grade,
--    source), so a sibling's details aren't lost (ADR 0007: a sibling is a note). A door without a note of its own
--    (WhatsApp) writes one only when the child differs from the lead's, and never the same note twice.
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
