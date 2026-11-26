-- 119 — M4 one door (#67, ADR 0031): intake_lead, the one function every door calls (WhatsApp, staff quick-add,
-- website form; src/admissions/lib/intake.ts validates and routes first). Runs as the caller: quick-add through RLS as
-- the staff member, WhatsApp and the website form as service_role.
--
-- p_lead: {phone (digits with country code) | contact_id, parent, child, child_dob, area, campus_id, grade,
--          source_keys (source tags, first match wins), note, reopen (default true)}.
-- 1. Find-or-create the contact by normalised phone, with or without 91 (invariant 3; a racing door hits the unique
--    index and re-reads).
-- 2. Reuse the contact's open lead (G4.1), else open one in the first stage of the Admissions pipeline. With
--    reopen = false (a WhatsApp message with no source code) a contact whose lead has closed gets no new lead.
-- 3. A reused lead keeps what it has and only fills blanks (a sibling stays a note, ADR 0007); a note is added.
-- Source tags are looked up in p_account_id only, so another account's tag never matches.
-- Returns {contact_id, lead_id, created}; lead_id is null when nothing was opened.
CREATE FUNCTION public.intake_lead(p_account_id uuid, p_lead jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  -- service_role has no auth.uid(); rows that need an author get the account owner, as wacrm's webhook does
  v_user uuid := coalesce(auth.uid(), (SELECT owner_user_id FROM accounts WHERE id = p_account_id));
  v_contact uuid := (p_lead->>'contact_id')::uuid;
  v_phone text := nullif(p_lead->>'phone', '');
  v_source uuid;
  v_stage uuid;
  v_deal uuid;
  v_lead uuid;
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
  UPDATE contacts SET name = p_lead->>'parent'
    WHERE id = v_contact AND coalesce(name, '') = '' AND coalesce(p_lead->>'parent', '') <> '';

  SELECT s.id INTO v_source
    FROM jsonb_array_elements_text(coalesce(p_lead->'source_keys', '[]')) WITH ORDINALITY AS k(key, n)
    JOIN admissions_settings s ON s.account_id = p_account_id AND s.kind = 'source' AND s.key = k.key
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
               coalesce(nullif(p_lead->>'child', ''), (SELECT coalesce(nullif(name, ''), phone) FROM contacts WHERE id = v_contact))
        FROM pipeline_stages s WHERE s.id = v_stage
        RETURNING id INTO v_deal;
      INSERT INTO leads (account_id, deal_id, contact_id, child_name, child_dob, grade, campus_id, area, source_id)
        VALUES (p_account_id, v_deal, v_contact, nullif(p_lead->>'child', ''), (p_lead->>'child_dob')::date,
                nullif(p_lead->>'grade', ''), (p_lead->>'campus_id')::uuid, nullif(p_lead->>'area', ''), v_source)
        RETURNING id INTO v_lead;
      v_created := true;
    EXCEPTION WHEN unique_violation THEN -- another door opened it a moment ago: use that one (the deal rolls back too)
      SELECT id INTO v_lead FROM leads WHERE contact_id = v_contact AND exit IS NULL AND admitted_at IS NULL;
    END;
  END IF;

  IF NOT v_created THEN
    UPDATE leads SET
      child_name = coalesce(child_name, nullif(p_lead->>'child', '')),
      child_dob = coalesce(child_dob, (p_lead->>'child_dob')::date),
      grade = coalesce(grade, nullif(p_lead->>'grade', '')),
      campus_id = coalesce(campus_id, (p_lead->>'campus_id')::uuid),
      area = coalesce(area, nullif(p_lead->>'area', '')),
      source_id = coalesce(source_id, v_source)
    WHERE id = v_lead;
    IF coalesce(p_lead->>'note', '') <> '' THEN
      INSERT INTO contact_notes (contact_id, user_id, note_text, account_id)
        VALUES (v_contact, v_user, p_lead->>'note', p_account_id);
    END IF;
  END IF;
  RETURN jsonb_build_object('contact_id', v_contact, 'lead_id', v_lead, 'created', v_created);
END $$;

REVOKE ALL ON FUNCTION public.intake_lead(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.intake_lead(uuid, jsonb) TO authenticated, service_role;
