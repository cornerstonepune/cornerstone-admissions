-- 124 — Conversation log (ADR 0039): every call, visit, meeting or note with a family, kept on the lead.
-- Audio sits in the private `conversation-audio` bucket at <account_id>/<lead_id>/<file>; the server transcribes it
-- (Sarvam) and breaks it into sections (Claude). Same access as lead_activity (101): members read, agent+ write,
-- admin deletes, each account to itself.

CREATE TABLE public.lead_conversations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  lead_id          uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  kind             text NOT NULL CHECK (kind IN ('call', 'visit', 'meeting', 'note')),
  happened_at      timestamptz NOT NULL DEFAULT now(),
  created_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  audio_path       text,                  -- null for a typed note, and once the audio is past retention
  audio_deleted_at timestamptz,
  duration_s       integer CHECK (duration_s >= 0),
  typed_note       text,
  status           text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'transcribing', 'analysing', 'done', 'failed')),
  error            text,
  attempts         smallint NOT NULL DEFAULT 0,
  claimed_at       timestamptz,           -- a worker's lock; stale after 10 minutes
  provider_job_id  text,                  -- the Sarvam batch job
  transcript_en    text,
  summary          text,
  concerns         jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{tag, detail}]
  questions        jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [text]
  action_points    jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{text, owner, due}]
  interest         text CHECK (interest IN ('hot', 'warm', 'cold')),
  suggested_stage  text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lead_conversations_lead_idx ON public.lead_conversations (lead_id, happened_at DESC);
CREATE INDEX lead_conversations_open_idx ON public.lead_conversations (created_at)
  WHERE status IN ('pending', 'transcribing', 'analysing');

CREATE TRIGGER update_lead_conversations_updated_at BEFORE UPDATE ON public.lead_conversations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- A conversation belongs to a lead of its own account (like check_lead_activity_refs).
CREATE FUNCTION public.check_lead_conversation_lead() RETURNS trigger
  LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.leads WHERE id = NEW.lead_id AND account_id = NEW.account_id) THEN
    RAISE EXCEPTION 'A conversation can only belong to a lead of its own account' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER lead_conversations_check_lead BEFORE INSERT OR UPDATE OF lead_id, account_id
  ON public.lead_conversations FOR EACH ROW EXECUTE FUNCTION public.check_lead_conversation_lead();

ALTER TABLE public.lead_conversations ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_conversations TO authenticated;
GRANT ALL ON public.lead_conversations TO service_role;

CREATE POLICY lead_conversations_select ON public.lead_conversations FOR SELECT TO authenticated
  USING (public.is_account_member(account_id));
CREATE POLICY lead_conversations_insert ON public.lead_conversations FOR INSERT TO authenticated
  WITH CHECK (public.is_account_member(account_id, 'agent'));
CREATE POLICY lead_conversations_update ON public.lead_conversations FOR UPDATE TO authenticated
  USING (public.is_account_member(account_id, 'agent')) WITH CHECK (public.is_account_member(account_id, 'agent'));
CREATE POLICY lead_conversations_delete ON public.lead_conversations FOR DELETE TO authenticated
  USING (public.is_account_member(account_id, 'admin'));

-- Private bucket: never public, 50 MB, the audio types phones and browsers produce.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'conversation-audio',
  'conversation-audio',
  false,
  52428800,
  ARRAY['audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/mpeg', 'audio/mp3', 'audio/aac', 'audio/x-aac', 'audio/amr',
        'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/ogg', 'audio/opus', 'audio/webm']
)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- The first folder is the account id. Compared as text so a malformed path is refused, not an error.
CREATE POLICY "Members read conversation audio" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'conversation-audio' AND EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid()
      AND p.account_id::text = (storage.foldername(name))[1]));
CREATE POLICY "Agents upload conversation audio" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'conversation-audio' AND EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid()
      AND p.account_id::text = (storage.foldername(name))[1]
      AND p.account_role IN ('owner', 'admin', 'agent')));
CREATE POLICY "Admins delete conversation audio" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'conversation-audio' AND EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid()
      AND p.account_id::text = (storage.foldername(name))[1]
      AND p.account_role IN ('owner', 'admin')));

-- redeem_invitation refuses to delete an old account that holds data; lead_conversations counts too.
-- Body = migration 102's plus one line.
CREATE OR REPLACE FUNCTION public.redeem_invitation(
  p_token_hash TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_inv account_invitations%ROWTYPE;
  v_old_account_id UUID;
  v_old_account_owner UUID;
  v_has_other_members BOOLEAN;
  v_has_data BOOLEAN;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_inv
  FROM account_invitations
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found' USING ERRCODE = '22023';
  END IF;
  IF v_inv.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invitation has already been redeemed'
      USING ERRCODE = '22023';
  END IF;
  IF v_inv.expires_at <= NOW() THEN
    RAISE EXCEPTION 'Invitation has expired' USING ERRCODE = '22023';
  END IF;

  SELECT p.account_id, a.owner_user_id
  INTO v_old_account_id, v_old_account_owner
  FROM profiles p
  JOIN accounts a ON a.id = p.account_id
  WHERE p.user_id = v_caller_id
  FOR UPDATE OF p, a;

  IF v_old_account_id IS NULL THEN
    INSERT INTO profiles (user_id, full_name, email, account_id, account_role)
    SELECT u.id, COALESCE(u.raw_user_meta_data->>'full_name', ''), u.email, v_inv.account_id, v_inv.role
    FROM auth.users u
    WHERE u.id = v_caller_id;

    UPDATE account_invitations
    SET accepted_at = NOW(),
        accepted_by_user_id = v_caller_id
    WHERE id = v_inv.id;

    RETURN v_inv.account_id;
  END IF;

  IF v_old_account_id = v_inv.account_id THEN
    RAISE EXCEPTION 'You are already a member of this account'
      USING ERRCODE = '23505';
  END IF;

  IF v_old_account_owner <> v_caller_id THEN
    RAISE EXCEPTION 'You are already in a shared account; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE account_id = v_old_account_id
      AND user_id <> v_caller_id
  ) INTO v_has_other_members;

  IF v_has_other_members THEN
    RAISE EXCEPTION 'Your account has other members; remove them or transfer ownership before joining another account'
      USING ERRCODE = '23505';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM contacts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM conversations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM broadcasts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automation_logs WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automation_pending_executions WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM flows WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM flow_runs WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM pipelines WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM deals WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM message_templates WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM tags WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM custom_fields WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM contact_notes WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM whatsapp_config WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM api_keys WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM admissions_settings WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM leads WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM visits WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM lead_stage_history WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM lead_activity WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM lead_conversations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM settings_changes WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM webhook_endpoints WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM quick_replies WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM notifications WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_configs WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_knowledge_documents WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_knowledge_chunks WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_usage_log WHERE account_id = v_old_account_id
    LIMIT 1
  ) INTO v_has_data;

  IF v_has_data THEN
    RAISE EXCEPTION 'Your account already contains data; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  UPDATE profiles
  SET account_id = v_inv.account_id,
      account_role = v_inv.role
  WHERE user_id = v_caller_id;

  UPDATE account_invitations
  SET accepted_at = NOW(),
      accepted_by_user_id = v_caller_id
  WHERE id = v_inv.id;

  DELETE FROM accounts WHERE id = v_old_account_id;

  RETURN v_inv.account_id;
END;
$$;
