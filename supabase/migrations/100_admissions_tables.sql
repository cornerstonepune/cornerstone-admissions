-- 100 — the six admissions tables (ADR 0010, spec docs/spec/m0-data-model.md).
--
-- Tables, keys, checks and indexes only. RLS is ON with no policies (deny by default) until 101 adds them.
-- Behaviour (triggers, view, invite path) arrives in 101–106, one ticket each.
-- Upstream tables stay untouched (ADR 0009).

CREATE TYPE public.lead_exit AS ENUM ('lost', 'dormant');
CREATE TYPE public.visit_status AS ENUM ('booked', 'rescheduled', 'cancelled', 'no_show', 'visited');
CREATE TYPE public.admissions_setting_kind AS ENUM ('campus', 'source', 'lost_reason', 'follow_up_rule', 'alert');
CREATE TYPE public.lead_activity_kind AS ENUM ('follow_up_send', 'call_task');
CREATE TYPE public.settings_change_action AS ENUM ('insert', 'update', 'delete');

-- One row per campus, source, lost reason, follow-up rule or alert.
CREATE TABLE public.admissions_settings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  kind        public.admissions_setting_kind NOT NULL,
  key         text NOT NULL CHECK (key ~ '^[a-z0-9_]+$'),
  label       text NOT NULL CHECK (btrim(label) <> ''),
  value       jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(value) = 'object'),
  active      boolean NOT NULL DEFAULT true,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, kind, key),
  -- follow-up rule: {"stage": text, "days": int >= 0, "action": send_template|call_task|dormant, "template": text if send_template}
  CONSTRAINT admissions_settings_follow_up_rule_value CHECK (
    kind <> 'follow_up_rule' OR (
      jsonb_typeof(value->'stage') = 'string'
      AND jsonb_typeof(value->'days') = 'number'
      AND (value->>'days') ~ '^[0-9]+$'
      AND value->>'action' IN ('send_template', 'call_task', 'dormant')
      AND (value->>'action' <> 'send_template' OR jsonb_typeof(value->'template') = 'string')
    )
  ),
  -- alert: {"threshold": number >= 0} (hours for untouched, days for stuck; the key says which)
  CONSTRAINT admissions_settings_alert_value CHECK (
    kind <> 'alert' OR (
      jsonb_typeof(value->'threshold') = 'number' AND (value->>'threshold')::numeric >= 0
    )
  )
);

-- A lead = one deal in the Admissions pipeline + this row (ADR 0007).
CREATE TABLE public.leads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  deal_id         uuid NOT NULL UNIQUE REFERENCES public.deals(id) ON DELETE CASCADE,
  -- copy of deals.contact_id so "one open lead per contact" is a unique index; 103 keeps them equal
  contact_id      uuid NOT NULL REFERENCES public.contacts(id) ON DELETE RESTRICT,
  child_name      text,
  child_dob       date,
  grade           text,
  campus_id       uuid REFERENCES public.admissions_settings(id) ON DELETE RESTRICT,
  area            text,
  source_id       uuid REFERENCES public.admissions_settings(id) ON DELETE RESTRICT,
  exit            public.lead_exit,
  lost_reason_id  uuid REFERENCES public.admissions_settings(id) ON DELETE RESTRICT,
  exited_at       timestamptz,
  admitted_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- invariant 4: Lost if and only if a lost reason
  CONSTRAINT leads_lost_has_reason CHECK ((exit IS NOT DISTINCT FROM 'lost') = (lost_reason_id IS NOT NULL)),
  CONSTRAINT leads_exit_has_time CHECK ((exit IS NULL) = (exited_at IS NULL)),
  CONSTRAINT leads_admitted_or_exited CHECK (exit IS NULL OR admitted_at IS NULL)
);
-- invariant 3: at most one open lead per contact (open = no exit and not admitted)
CREATE UNIQUE INDEX leads_one_open_per_contact ON public.leads (contact_id)
  WHERE exit IS NULL AND admitted_at IS NULL;
CREATE INDEX leads_account_id_idx ON public.leads (account_id);

-- Every Cal.com booking for a lead. A reschedule is a new row; the old one becomes 'rescheduled'.
CREATE TABLE public.visits (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  lead_id         uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  cal_booking_id  text NOT NULL UNIQUE CHECK (btrim(cal_booking_id) <> ''),  -- invariant 6: a repeated webhook changes nothing
  starts_at       timestamptz NOT NULL,
  campus_id       uuid REFERENCES public.admissions_settings(id) ON DELETE RESTRICT,
  status          public.visit_status NOT NULL DEFAULT 'booked',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX visits_lead_id_idx ON public.visits (lead_id, created_at DESC);

-- One row per stage a lead entered (invariant 5). Days in stage = now() - entered_at of the lead's latest row.
CREATE TABLE public.lead_stage_history (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  lead_id     uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  stage_id    uuid NOT NULL REFERENCES public.pipeline_stages(id) ON DELETE RESTRICT,
  entered_at  timestamptz NOT NULL DEFAULT now(),
  moved_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE INDEX lead_stage_history_lead_idx ON public.lead_stage_history (lead_id, entered_at DESC);

-- Follow-up sends and call tasks; a call task holds its call log once made.
CREATE TABLE public.lead_activity (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  lead_id           uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  kind              public.lead_activity_kind NOT NULL,
  rule_id           uuid REFERENCES public.admissions_settings(id) ON DELETE SET NULL,
  stage_history_id  uuid REFERENCES public.lead_stage_history(id) ON DELETE CASCADE,
  message_id        uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  due_at            timestamptz NOT NULL DEFAULT now(),
  done_at           timestamptz,
  assigned_to       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  outcome           text,
  notes             text,
  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_activity_send_has_rule CHECK (
    kind <> 'follow_up_send' OR (rule_id IS NOT NULL AND stage_history_id IS NOT NULL)
  )
);
-- invariant 6: at most one send per (lead, rule, stage entry)
CREATE UNIQUE INDEX lead_activity_one_send_per_rule_entry ON public.lead_activity (lead_id, rule_id, stage_history_id)
  WHERE kind = 'follow_up_send';
CREATE INDEX lead_activity_open_calls_idx ON public.lead_activity (account_id, due_at)
  WHERE kind = 'call_task' AND done_at IS NULL;

-- Audit of admissions_settings (invariant 7). Written only by 105's trigger; no FK to the setting so deletes keep their row.
CREATE TABLE public.settings_changes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  setting_id  uuid NOT NULL,
  kind        public.admissions_setting_kind NOT NULL,
  key         text NOT NULL,
  action      public.settings_change_action NOT NULL,
  old_value   jsonb,   -- the whole row before, null on insert
  new_value   jsonb,   -- the whole row after, null on delete
  changed_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX settings_changes_account_idx ON public.settings_changes (account_id, changed_at DESC);

CREATE TRIGGER update_admissions_settings_updated_at BEFORE UPDATE ON public.admissions_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_leads_updated_at BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_visits_updated_at BEFORE UPDATE ON public.visits
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_lead_activity_updated_at BEFORE UPDATE ON public.lead_activity
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.admissions_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visits              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_stage_history  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_activity       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings_changes    ENABLE ROW LEVEL SECURITY;

-- redeem_invitation deletes the joiner's old account (cascade). It must refuse when that account holds admissions
-- data, as it already does for upstream tables (guard: src/lib/auth/redeem-invitation-migration.test.ts).
-- Body = migration 047's, plus the six admissions tables in the data check. CREATE OR REPLACE keeps its grants.
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
    RAISE EXCEPTION 'Caller has no profile' USING ERRCODE = '42501';
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
