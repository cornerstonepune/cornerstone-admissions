-- db/schema.sql — the data model as it is today, as runnable SQL. Source of truth for PROJECT.md §3 (ADR 0005).
--
-- GENERATED, never hand-edited: `npm run db:reset && npm run db:schema` (supabase/ci/dump-schema.sh) replays
-- supabase/migrations/ (upstream 001–060 unmodified, then ours from 100) on the local Supabase Postgres 17 and runs
--   pg_dump --schema-only --no-owner --no-privileges --schema=public
-- Every migration PR regenerates it. Upstream and admissions tables both live in `public` (ADR 0009, ADR 0010).
--
-- Not in this dump, but created by the same migrations:
--   * trigger `on_auth_user_created` on auth.users → public.handle_new_user()  (removed by migration 102, ADR 0006)
--   * storage buckets `avatars`, `flow-media`, `chat-media` and their storage.objects policies
-- END HEADER
--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: account_role_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.account_role_enum AS ENUM (
    'owner',
    'admin',
    'agent',
    'viewer'
);


--
-- Name: admissions_setting_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.admissions_setting_kind AS ENUM (
    'campus',
    'source',
    'lost_reason',
    'follow_up_rule',
    'alert'
);


--
-- Name: lead_activity_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.lead_activity_kind AS ENUM (
    'follow_up_send',
    'call_task'
);


--
-- Name: lead_exit; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.lead_exit AS ENUM (
    'lost',
    'dormant'
);


--
-- Name: settings_change_action; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.settings_change_action AS ENUM (
    'insert',
    'update',
    'delete'
);


--
-- Name: visit_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.visit_status AS ENUM (
    'booked',
    'rescheduled',
    'cancelled',
    'no_show',
    'visited'
);


--
-- Name: _bcast_bump(uuid, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._bcast_bump(bid uuid, col text, delta integer) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
BEGIN
  EXECUTE format(
    'UPDATE broadcasts SET %I = GREATEST(0, %I + $1), updated_at = NOW() WHERE id = $2',
    col, col
  ) USING delta, bid;
END;
$_$;


--
-- Name: _bcast_cols_for_status(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._bcast_cols_for_status(s text) RETURNS text[]
    LANGUAGE plpgsql IMMUTABLE
    AS $$
BEGIN
  -- 'pending' contributes to nothing.
  IF s = 'pending' THEN RETURN ARRAY[]::TEXT[]; END IF;
  IF s = 'sent'      THEN RETURN ARRAY['sent_count']; END IF;
  IF s = 'delivered' THEN RETURN ARRAY['sent_count','delivered_count']; END IF;
  IF s = 'read'      THEN RETURN ARRAY['sent_count','delivered_count','read_count']; END IF;
  IF s = 'replied'   THEN RETURN ARRAY['sent_count','delivered_count','read_count','replied_count']; END IF;
  IF s = 'failed'    THEN RETURN ARRAY['failed_count']; END IF;
  RETURN ARRAY[]::TEXT[];
END;
$$;


--
-- Name: acquire_broadcast_delivery_lease(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.acquire_broadcast_delivery_lease(p_broadcast_id uuid) RETURNS timestamp with time zone
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_lease TIMESTAMPTZ;
BEGIN
  UPDATE broadcasts b
  SET delivery_lease_until = now() + INTERVAL '5 minutes'
  WHERE b.id = p_broadcast_id
    AND is_account_member(b.account_id, 'agent')
    AND (b.delivery_lease_until IS NULL OR b.delivery_lease_until < now())
    AND (b.delivery_locked_at IS NULL OR b.delivery_locked_at < now() - INTERVAL '30 minutes')
  RETURNING b.delivery_lease_until INTO v_lease;
  RETURN v_lease;
END;
$$;


--
-- Name: admissions_setting_is(uuid, uuid, public.admissions_setting_kind); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admissions_setting_is(p_setting_id uuid, p_account_id uuid, p_kind public.admissions_setting_kind) RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  SELECT p_setting_id IS NULL OR EXISTS (
    SELECT 1 FROM public.admissions_settings s
    WHERE s.id = p_setting_id AND s.account_id = p_account_id AND s.kind = p_kind)
$$;


--
-- Name: audit_admissions_settings(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_admissions_settings() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  r public.admissions_settings := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
BEGIN
  -- Skipped when the whole account is being deleted (cascade): the FK to accounts would fail.
  INSERT INTO public.settings_changes (account_id, setting_id, kind, key, action, old_value, new_value, changed_by)
  SELECT r.account_id, r.id, r.kind, r.key, lower(TG_OP)::public.settings_change_action,
         CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
         CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
         auth.uid()
  WHERE EXISTS (SELECT 1 FROM public.accounts WHERE id = r.account_id);
  RETURN NULL;
END;
$$;


--
-- Name: broadcast_delivery_in_flight(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.broadcast_delivery_in_flight(p_broadcast_id uuid) RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  SELECT COALESCE((
    SELECT b.delivery_locked_at > now() - INTERVAL '30 minutes'
      OR b.delivery_lease_until > now()
    FROM broadcasts b
    WHERE b.id = p_broadcast_id
  ), FALSE)
$$;


--
-- Name: broadcast_recipient_aggregate_trigger(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.broadcast_recipient_aggregate_trigger() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  old_cols TEXT[];
  new_cols TEXT[];
  c TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    new_cols := _bcast_cols_for_status(NEW.status);
    FOREACH c IN ARRAY new_cols LOOP
      PERFORM _bcast_bump(NEW.broadcast_id, c, 1);
    END LOOP;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    old_cols := _bcast_cols_for_status(OLD.status);
    FOREACH c IN ARRAY old_cols LOOP
      PERFORM _bcast_bump(OLD.broadcast_id, c, -1);
    END LOOP;
    RETURN OLD;
  END IF;

  -- UPDATE: only care if status changed.
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    old_cols := _bcast_cols_for_status(OLD.status);
    new_cols := _bcast_cols_for_status(NEW.status);
    -- Subtract the old contributions, add the new.
    FOREACH c IN ARRAY old_cols LOOP
      PERFORM _bcast_bump(NEW.broadcast_id, c, -1);
    END LOOP;
    FOREACH c IN ARRAY new_cols LOOP
      PERFORM _bcast_bump(NEW.broadcast_id, c, 1);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: bump_conversation_on_inbound(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.bump_conversation_on_inbound(p_conversation_id uuid, p_last_message_text text) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  UPDATE conversations
  SET unread_count      = COALESCE(unread_count, 0) + 1,
      last_message_text = p_last_message_text,
      last_message_at   = NOW(),
      updated_at        = NOW()
  WHERE id = p_conversation_id;
$$;


--
-- Name: check_lead_activity_refs(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_lead_activity_refs() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NOT public.admissions_setting_is(NEW.rule_id, NEW.account_id, 'follow_up_rule') THEN
    RAISE EXCEPTION 'A lead activity can only use a follow-up rule of its own account' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.leads WHERE id = NEW.lead_id AND account_id = NEW.account_id) THEN
    RAISE EXCEPTION 'A lead activity can only belong to a lead of its own account' USING ERRCODE = '23514';
  END IF;
  IF NEW.stage_history_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.lead_stage_history WHERE id = NEW.stage_history_id AND lead_id = NEW.lead_id) THEN
    RAISE EXCEPTION 'A lead activity can only point at a stage entry of its own lead' USING ERRCODE = '23514';
  END IF;
  IF NEW.message_id IS NOT NULL AND NOT public.message_in_account(NEW.message_id, NEW.account_id) THEN
    RAISE EXCEPTION 'A lead activity can only point at a message of its own account' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;


--
-- Name: check_lead_integrity(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_lead_integrity() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.account_id IS DISTINCT FROM OLD.account_id OR NEW.deal_id IS DISTINCT FROM OLD.deal_id) THEN
    RAISE EXCEPTION 'A lead''s account and deal never change' USING ERRCODE = '23514';
  END IF;
  IF NOT public.admissions_setting_is(NEW.campus_id, NEW.account_id, 'campus')
     OR NOT public.admissions_setting_is(NEW.source_id, NEW.account_id, 'source')
     OR NOT public.admissions_setting_is(NEW.lost_reason_id, NEW.account_id, 'lost_reason') THEN
    RAISE EXCEPTION 'A lead can only use campus, source and lost-reason settings of its own account and the right kind'
      USING ERRCODE = '23514';
  END IF;
  IF NOT public.deal_matches_lead(NEW.deal_id, NEW.account_id, NEW.contact_id) THEN
    RAISE EXCEPTION 'A lead must be in the same account and have the same contact as its deal' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;


--
-- Name: check_rule_action_in_use(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_rule_action_in_use() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF OLD.kind = 'follow_up_rule' AND NEW.value->>'action' IS DISTINCT FROM OLD.value->>'action'
     AND EXISTS (SELECT 1 FROM lead_activity WHERE rule_id = OLD.id) THEN
    RAISE EXCEPTION 'A follow-up rule in use cannot change its action' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: check_rule_made_activity(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_rule_made_activity() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.rule_id IS DISTINCT FROM OLD.rule_id
                           OR NEW.stage_history_id IS DISTINCT FROM OLD.stage_history_id) THEN
    RAISE EXCEPTION 'A lead activity keeps its rule and stage entry' USING ERRCODE = '23514';
  END IF;
  IF NEW.rule_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.admissions_settings s WHERE s.id = NEW.rule_id
       AND (s.value->>'action', NEW.kind::text) IN (('send_template', 'follow_up_send'), ('call_task', 'call_task'))) THEN
    RAISE EXCEPTION 'A rule-made activity must be the kind its rule makes' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;


--
-- Name: check_setting_in_use(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_setting_in_use() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF (NEW.kind IS DISTINCT FROM OLD.kind OR NEW.account_id IS DISTINCT FROM OLD.account_id)
     AND (EXISTS (SELECT 1 FROM leads WHERE campus_id = OLD.id OR source_id = OLD.id OR lost_reason_id = OLD.id)
       OR EXISTS (SELECT 1 FROM visits WHERE campus_id = OLD.id)
       OR EXISTS (SELECT 1 FROM lead_activity WHERE rule_id = OLD.id)) THEN
    RAISE EXCEPTION 'A setting in use cannot change its kind or account' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: check_visit_refs(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_visit_refs() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NOT public.admissions_setting_is(NEW.campus_id, NEW.account_id, 'campus') THEN
    RAISE EXCEPTION 'A visit can only use a campus setting of its own account' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.leads WHERE id = NEW.lead_id AND account_id = NEW.account_id) THEN
    RAISE EXCEPTION 'A visit can only belong to a lead of its own account' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;


--
-- Name: claim_ai_reply_slot(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_ai_reply_slot(conversation_id uuid, max_replies integer) RETURNS boolean
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  WITH claimed AS (
    UPDATE conversations
    SET ai_reply_count = ai_reply_count + 1
    WHERE id = conversation_id
      AND ai_reply_count < max_replies
      AND NOT ai_autoreply_disabled
      AND assigned_agent_id IS NULL
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM claimed);
$$;


--
-- Name: create_broadcast_with_recipients(uuid, uuid, text, text, text, integer, uuid[], jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_broadcast_with_recipients(p_account_id uuid, p_user_id uuid, p_name text, p_template_name text, p_template_language text, p_total_recipients integer, p_contact_ids uuid[], p_template_params jsonb) RETURNS TABLE(broadcast_id uuid, recipient_id uuid, contact_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_broadcast_id UUID;
BEGIN
  IF p_template_params IS NULL OR jsonb_typeof(p_template_params) <> 'array' THEN
    RAISE EXCEPTION 'p_template_params must be a JSON array with one params array per contact'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_array_length(p_template_params) <> COALESCE(cardinality(p_contact_ids), 0) THEN
    RAISE EXCEPTION 'p_template_params has % entries but p_contact_ids has %',
      jsonb_array_length(p_template_params), COALESCE(cardinality(p_contact_ids), 0)
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_template_params) AS params(value)
    WHERE jsonb_typeof(params.value) <> 'array'
  ) THEN
    RAISE EXCEPTION 'every p_template_params entry must be a JSON array'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO broadcasts (
    account_id, user_id, name, template_name,
    template_language, status, total_recipients
  )
  VALUES (
    p_account_id, p_user_id, p_name, p_template_name,
    p_template_language, 'sending', p_total_recipients
  )
  RETURNING id INTO v_broadcast_id;

  RETURN QUERY
  WITH ins AS (
    INSERT INTO broadcast_recipients (
      broadcast_id, contact_id, status, template_params
    )
    SELECT v_broadcast_id, contacts_in.cid, 'pending', params_in.prm
    FROM unnest(p_contact_ids) WITH ORDINALITY AS contacts_in(cid, ordinal)
    JOIN jsonb_array_elements(p_template_params) WITH ORDINALITY AS params_in(prm, ordinal)
      ON params_in.ordinal = contacts_in.ordinal
    ORDER BY contacts_in.ordinal
    RETURNING id, broadcast_recipients.contact_id
  )
  SELECT v_broadcast_id, ins.id, ins.contact_id
  FROM ins;
END;
$$;


--
-- Name: dashboard_overview(integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.dashboard_overview(p_days integer, p_tz text DEFAULT 'UTC'::text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_account UUID;
  v_tz TEXT := 'UTC';
  v_now TIMESTAMPTZ := now();
  v_start TIMESTAMPTZ;
  v_prev_start TIMESTAMPTZ;
  v_prev_end TIMESTAMPTZ;
  v_unit TEXT;
  v_step INTERVAL;
  v_target INTEGER;
  v_attention JSONB;
  v_replies JSONB;
  v_volume JSONB;
  v_kpis JSONB;
  v_pipeline JSONB;
  v_campaigns JSONB;
  v_setup JSONB;
BEGIN
  SELECT p.account_id INTO v_account
  FROM profiles p
  WHERE p.user_id = auth.uid();

  IF v_account IS NULL THEN
    RAISE EXCEPTION 'caller is not a member of an account' USING ERRCODE = '42501';
  END IF;

  IF p_days IS NULL OR p_days NOT IN (1, 7, 30, 90) THEN
    RAISE EXCEPTION 'p_days must be one of 1, 7, 30, 90' USING ERRCODE = '22023';
  END IF;

  IF p_tz IS NOT NULL THEN
    BEGIN
      PERFORM v_now AT TIME ZONE p_tz;
      v_tz := p_tz;
    EXCEPTION WHEN invalid_parameter_value THEN
      v_tz := 'UTC';
    END;
  END IF;

  v_start := (date_trunc('day', v_now AT TIME ZONE v_tz) - make_interval(days => p_days - 1)) AT TIME ZONE v_tz;
  v_prev_start := v_start - make_interval(days => p_days);
  v_prev_end := v_now - make_interval(days => p_days);
  v_unit := CASE WHEN p_days = 1 THEN 'hour' ELSE 'day' END;
  v_step := CASE WHEN p_days = 1 THEN interval '1 hour' ELSE interval '1 day' END;

  SELECT a.reply_target_minutes INTO v_target FROM accounts a WHERE a.id = v_account;
  v_target := COALESCE(v_target, 5);

  WITH awaiting AS (
    SELECT
      c.id,
      c.contact_id,
      c.assigned_agent_id,
      c.last_message_text,
      c.last_inbound_at,
      (c.ai_autoreply_disabled AND c.ai_handoff_summary IS NOT NULL) AS handed_off,
      COALESCE((
        SELECT min(m.created_at)
        FROM messages m
        WHERE m.conversation_id = c.id
          AND m.sender_type = 'customer'
          AND m.created_at > COALESCE(c.last_reply_at, '-infinity'::timestamptz)
      ), c.last_inbound_at) AS waiting_since
    FROM conversations c
    WHERE c.account_id = v_account
      AND c.status <> 'closed'
      AND c.last_inbound_at IS NOT NULL
      AND (c.last_reply_at IS NULL OR c.last_reply_at < c.last_inbound_at)
  ),
  failed AS (
    SELECT m.id, m.conversation_id, m.content_text, m.error_code, m.error_title, m.created_at,
           ct.name AS contact_name, ct.phone AS contact_phone
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    LEFT JOIN contacts ct ON ct.id = c.contact_id
    WHERE c.account_id = v_account
      AND m.sender_type <> 'customer'
      AND m.status = 'failed'
      AND m.created_at >= v_now - interval '24 hours'
  )
  SELECT jsonb_build_object(
    'waiting', (SELECT count(*) FROM awaiting),
    'oldestWaitingSince', (SELECT min(waiting_since) FROM awaiting),
    'waitingOverTarget', (SELECT count(*) FROM awaiting WHERE waiting_since < v_now - make_interval(mins => v_target)),
    'unassigned', (
      SELECT count(*) FROM conversations c
      WHERE c.account_id = v_account AND c.status = 'open' AND c.assigned_agent_id IS NULL
    ),
    'windowsClosing', (
      SELECT count(*) FROM awaiting
      WHERE last_inbound_at > v_now - interval '24 hours'
        AND last_inbound_at <= v_now - interval '22 hours'
    ),
    'failed', (SELECT count(*) FROM failed),
    'failedMessages', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', f.id,
        'conversationId', f.conversation_id,
        'contactName', f.contact_name,
        'contactPhone', f.contact_phone,
        'preview', left(f.content_text, 120),
        'errorCode', f.error_code,
        'errorTitle', f.error_title,
        'at', f.created_at
      ) ORDER BY f.created_at DESC)
      FROM (SELECT * FROM failed ORDER BY created_at DESC LIMIT 10) f
    ), '[]'::jsonb),
    'queue', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'conversationId', q.id,
        'contactName', ct.name,
        'contactPhone', ct.phone,
        'avatarUrl', ct.avatar_url,
        'preview', left(q.last_message_text, 120),
        'waitingSince', q.waiting_since,
        'windowClosesAt', q.last_inbound_at + interval '24 hours',
        'assignedAgentId', q.assigned_agent_id,
        'handedOff', COALESCE(q.handed_off, false)
      ) ORDER BY q.waiting_since)
      FROM (SELECT * FROM awaiting ORDER BY waiting_since LIMIT 6) q
      LEFT JOIN contacts ct ON ct.id = q.contact_id
    ), '[]'::jsonb)
  ) INTO v_attention;

  WITH msgs AS (
    SELECT m.id, m.conversation_id, m.sender_type, m.ai_generated, m.status, m.created_at
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE c.account_id = v_account
      AND m.created_at >= v_prev_start - interval '1 day'
  ),
  streams AS (
    SELECT
      'human'::text AS kind,
      conversation_id,
      created_at,
      sender_type = 'customer' AS is_customer,
      lag(sender_type = 'customer') OVER (PARTITION BY conversation_id ORDER BY created_at, id) AS prev_customer
    FROM msgs
    WHERE sender_type = 'customer' OR (sender_type = 'agent' AND status <> 'failed')
    UNION ALL
    SELECT
      'ai'::text,
      conversation_id,
      created_at,
      sender_type = 'customer',
      lag(sender_type = 'customer') OVER (PARTITION BY conversation_id ORDER BY created_at, id)
    FROM msgs
    WHERE sender_type = 'customer' OR (ai_generated AND status <> 'failed')
  ),
  turns AS (
    SELECT
      s.kind,
      s.created_at AS asked_at,
      r.sender_id AS reply_agent,
      extract(epoch FROM r.created_at - s.created_at) / 60.0 AS minutes
    FROM streams s
    CROSS JOIN LATERAL (
      SELECT m2.sender_id, m2.created_at
      FROM messages m2
      WHERE m2.conversation_id = s.conversation_id
        AND m2.created_at > s.created_at
        AND m2.status <> 'failed'
        AND CASE WHEN s.kind = 'human' THEN m2.sender_type = 'agent' ELSE m2.ai_generated END
      ORDER BY m2.created_at, m2.id
      LIMIT 1
    ) r
    WHERE s.is_customer
      AND s.prev_customer IS NOT TRUE
      AND s.created_at >= v_prev_start
  ),
  members AS (
    SELECT p.user_id, p.full_name, p.avatar_url, p.account_role
    FROM profiles p
    WHERE p.account_id = v_account
  )
  SELECT jsonb_build_object(
    'medianHuman', (
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY minutes)
      FROM turns WHERE kind = 'human' AND asked_at >= v_start
    ),
    'medianHumanPrevious', (
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY minutes)
      FROM turns WHERE kind = 'human' AND asked_at >= v_prev_start AND asked_at < v_prev_end
    ),
    'team', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'userId', mb.user_id,
        'name', mb.full_name,
        'avatarUrl', mb.avatar_url,
        'role', mb.account_role,
        'presence', mp.status,
        'lastSeenAt', mp.last_seen_at,
        'open', (
          SELECT count(*) FROM conversations c
          WHERE c.account_id = v_account AND c.status <> 'closed' AND c.assigned_agent_id = mb.user_id
        ),
        'replies', (
          SELECT count(*) FROM turns
          WHERE kind = 'human' AND reply_agent = mb.user_id AND asked_at >= v_start
        ),
        'medianMinutes', (
          SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY minutes)
          FROM turns
          WHERE kind = 'human' AND reply_agent = mb.user_id AND asked_at >= v_start
        )
      ) ORDER BY mb.full_name NULLS LAST)
      FROM members mb
      LEFT JOIN member_presence mp ON mp.user_id = mb.user_id AND mp.account_id = v_account
    ), '[]'::jsonb),
    'ai', jsonb_build_object(
      'replies', (
        SELECT count(*)
        FROM messages m
        JOIN conversations c ON c.id = m.conversation_id
        WHERE c.account_id = v_account AND m.ai_generated AND m.created_at >= v_start
      ),
      'medianMinutes', (
        SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY minutes)
        FROM turns WHERE kind = 'ai' AND asked_at >= v_start
      )
    )
  ) INTO v_replies;

  WITH buckets AS (
    SELECT b
    FROM generate_series(
      date_trunc(v_unit, v_start AT TIME ZONE v_tz),
      date_trunc(v_unit, v_now AT TIME ZONE v_tz),
      v_step
    ) AS b
  ),
  period_msgs AS (
    SELECT m.sender_type, m.created_at AT TIME ZONE v_tz AS local_at
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE c.account_id = v_account
      AND m.created_at >= v_start
  ),
  msg_counts AS (
    SELECT date_trunc(v_unit, local_at) AS b,
           count(*) FILTER (WHERE sender_type = 'customer') AS incoming,
           count(*) FILTER (WHERE sender_type <> 'customer') AS outgoing
    FROM period_msgs
    GROUP BY 1
  ),
  conv_counts AS (
    SELECT date_trunc(v_unit, created_at AT TIME ZONE v_tz) AS b, count(*) AS n
    FROM conversations
    WHERE account_id = v_account AND created_at >= v_start
    GROUP BY 1
  ),
  resolved_counts AS (
    SELECT date_trunc(v_unit, closed_at AT TIME ZONE v_tz) AS b, count(*) AS n
    FROM conversations
    WHERE account_id = v_account AND status = 'closed' AND closed_at >= v_start
    GROUP BY 1
  ),
  won_counts AS (
    SELECT date_trunc(v_unit, closed_at AT TIME ZONE v_tz) AS b, count(*) AS n
    FROM deals
    WHERE account_id = v_account AND status = 'won' AND closed_at >= v_start
    GROUP BY 1
  )
  SELECT jsonb_build_object(
    'series', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        't', to_char(bk.b, 'YYYY-MM-DD"T"HH24:MI'),
        'incoming', COALESCE(mc.incoming, 0),
        'outgoing', COALESCE(mc.outgoing, 0),
        'newConversations', COALESCE(cc.n, 0),
        'resolved', COALESCE(rc.n, 0),
        'dealsWon', COALESCE(wc.n, 0)
      ) ORDER BY bk.b)
      FROM buckets bk
      LEFT JOIN msg_counts mc ON mc.b = bk.b
      LEFT JOIN conv_counts cc ON cc.b = bk.b
      LEFT JOIN resolved_counts rc ON rc.b = bk.b
      LEFT JOIN won_counts wc ON wc.b = bk.b
    ), '[]'::jsonb),
    'hourly', (
      SELECT jsonb_agg(COALESCE(h.n, 0) ORDER BY hr.hour)
      FROM generate_series(0, 23) AS hr(hour)
      LEFT JOIN (
        SELECT extract(hour FROM local_at)::int AS hour, count(*) AS n
        FROM period_msgs
        WHERE sender_type = 'customer'
        GROUP BY 1
      ) h ON h.hour = hr.hour
    )
  ) INTO v_volume;

  SELECT jsonb_build_object(
    'newConversations', (
      SELECT count(*) FROM conversations
      WHERE account_id = v_account AND created_at >= v_start
    ),
    'newConversationsPrevious', (
      SELECT count(*) FROM conversations
      WHERE account_id = v_account AND created_at >= v_prev_start AND created_at < v_prev_end
    ),
    'resolved', (
      SELECT count(*) FROM conversations
      WHERE account_id = v_account AND status = 'closed' AND closed_at >= v_start
    ),
    'resolvedPrevious', (
      SELECT count(*) FROM conversations
      WHERE account_id = v_account AND status = 'closed' AND closed_at >= v_prev_start AND closed_at < v_prev_end
    ),
    'dealsWon', (
      SELECT count(*) FROM deals
      WHERE account_id = v_account AND status = 'won' AND closed_at >= v_start
    ),
    'dealsWonPrevious', (
      SELECT count(*) FROM deals
      WHERE account_id = v_account AND status = 'won' AND closed_at >= v_prev_start AND closed_at < v_prev_end
    ),
    'dealsWonValue', (
      SELECT COALESCE(sum(value), 0) FROM deals
      WHERE account_id = v_account AND status = 'won' AND closed_at >= v_start
    ),
    'broadcastDelivered', (
      SELECT COALESCE(sum(delivered_count), 0) FROM broadcasts
      WHERE account_id = v_account AND status IN ('sending', 'sent')
        AND COALESCE(scheduled_at, created_at) >= v_start
    ),
    'broadcastRead', (
      SELECT COALESCE(sum(read_count), 0) FROM broadcasts
      WHERE account_id = v_account AND status IN ('sending', 'sent')
        AND COALESCE(scheduled_at, created_at) >= v_start
    ),
    'broadcastDeliveredPrevious', (
      SELECT COALESCE(sum(delivered_count), 0) FROM broadcasts
      WHERE account_id = v_account AND status IN ('sending', 'sent')
        AND COALESCE(scheduled_at, created_at) >= v_prev_start
        AND COALESCE(scheduled_at, created_at) < v_prev_end
    ),
    'broadcastReadPrevious', (
      SELECT COALESCE(sum(read_count), 0) FROM broadcasts
      WHERE account_id = v_account AND status IN ('sending', 'sent')
        AND COALESCE(scheduled_at, created_at) >= v_prev_start
        AND COALESCE(scheduled_at, created_at) < v_prev_end
    )
  ) INTO v_kpis;

  SELECT jsonb_build_object(
    'pipelines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', pl.id, 'name', pl.name) ORDER BY pl.created_at, pl.id)
      FROM pipelines pl
      WHERE pl.account_id = v_account
    ), '[]'::jsonb),
    'stages', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', s.id,
        'pipelineId', s.pipeline_id,
        'name', s.name,
        'color', s.color,
        'dealCount', (SELECT count(*) FROM deals d WHERE d.stage_id = s.id AND d.status = 'open'),
        'totalValue', (SELECT COALESCE(sum(d.value), 0) FROM deals d WHERE d.stage_id = s.id AND d.status = 'open')
      ) ORDER BY s.position, s.created_at)
      FROM pipeline_stages s
      JOIN pipelines pl ON pl.id = s.pipeline_id
      WHERE pl.account_id = v_account
    ), '[]'::jsonb),
    'stats', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'pipelineId', pl.id,
        'won', (
          SELECT count(*) FROM deals d
          WHERE d.pipeline_id = pl.id AND d.status = 'won' AND d.closed_at >= v_start
        ),
        'lost', (
          SELECT count(*) FROM deals d
          WHERE d.pipeline_id = pl.id AND d.status = 'lost' AND d.closed_at >= v_start
        ),
        'avgDaysToWin', (
          SELECT avg(extract(epoch FROM d.closed_at - d.created_at) / 86400.0) FROM deals d
          WHERE d.pipeline_id = pl.id AND d.status = 'won' AND d.closed_at >= v_start
        ),
        'idleDeals', (
          SELECT count(*) FROM deals d
          WHERE d.pipeline_id = pl.id AND d.status = 'open' AND d.updated_at < v_now - interval '7 days'
        )
      ))
      FROM pipelines pl
      WHERE pl.account_id = v_account
    ), '[]'::jsonb)
  ) INTO v_pipeline;

  SELECT jsonb_build_object(
    'latestBroadcast', (
      SELECT jsonb_build_object(
        'id', b.id,
        'name', b.name,
        'status', b.status,
        'at', COALESCE(b.scheduled_at, b.created_at),
        'recipients', b.total_recipients,
        'delivered', b.delivered_count,
        'read', b.read_count,
        'replied', b.replied_count,
        'failed', b.failed_count
      )
      FROM broadcasts b
      WHERE b.account_id = v_account AND b.status IN ('sending', 'sent', 'failed')
      ORDER BY COALESCE(b.scheduled_at, b.created_at) DESC
      LIMIT 1
    ),
    'automationRuns', (
      SELECT count(*) FROM automation_logs
      WHERE account_id = v_account AND created_at >= v_start
    ),
    'automationFailed', (
      SELECT count(*) FROM automation_logs
      WHERE account_id = v_account AND created_at >= v_start AND status = 'failed'
    ),
    'flowFailed', (
      SELECT count(*) FROM flow_runs
      WHERE account_id = v_account AND status = 'failed' AND ended_at >= v_start
    ),
    'topFailingFlow', (
      SELECT jsonb_build_object('id', f.id, 'name', f.name, 'failed', count(*))
      FROM flow_runs r
      JOIN flows f ON f.id = r.flow_id
      WHERE r.account_id = v_account AND r.status = 'failed' AND r.ended_at >= v_start
      GROUP BY f.id, f.name
      ORDER BY count(*) DESC, f.name
      LIMIT 1
    ),
    'templatesApproved', (
      SELECT count(*) FROM message_templates
      WHERE account_id = v_account AND status = 'APPROVED'
    ),
    'templatesRejected', (
      SELECT count(*) FROM message_templates
      WHERE account_id = v_account AND status = 'REJECTED'
    )
  ) INTO v_campaigns;

  SELECT jsonb_build_object(
    'whatsappConnected', EXISTS (
      SELECT 1 FROM whatsapp_config WHERE account_id = v_account AND status = 'connected'
    ),
    'hasContacts', EXISTS (SELECT 1 FROM contacts WHERE account_id = v_account),
    'hasApprovedTemplate', EXISTS (
      SELECT 1 FROM message_templates WHERE account_id = v_account AND status = 'APPROVED'
    ),
    'memberCount', (SELECT count(*) FROM profiles WHERE account_id = v_account),
    'hasConversations', EXISTS (SELECT 1 FROM conversations WHERE account_id = v_account)
  ) INTO v_setup;

  RETURN jsonb_build_object(
    'generatedAt', v_now,
    'timeZone', v_tz,
    'days', p_days,
    'unit', v_unit,
    'periodStart', v_start,
    'previousStart', v_prev_start,
    'previousEnd', v_prev_end,
    'replyTargetMinutes', v_target,
    'attention', v_attention,
    'replies', v_replies,
    'volume', v_volume,
    'kpis', v_kpis,
    'pipeline', v_pipeline,
    'campaigns', v_campaigns,
    'setup', v_setup
  );
END;
$$;


--
-- Name: deal_matches_lead(uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.deal_matches_lead(p_deal_id uuid, p_account_id uuid, p_contact_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT (current_setting('role', true) IN ('service_role', 'postgres', 'none', '') OR public.is_account_member(p_account_id))
    AND EXISTS (SELECT 1 FROM public.deals
    WHERE id = p_deal_id AND account_id = p_account_id AND contact_id IS NOT DISTINCT FROM p_contact_id)
$$;


--
-- Name: enforce_account_identity_columns(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_account_identity_columns() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF (NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
      OR NEW.id IS DISTINCT FROM OLD.id
      OR NEW.created_at IS DISTINCT FROM OLD.created_at)
     AND current_user = 'authenticated'
  THEN
    RAISE EXCEPTION
      'owner_user_id, id and created_at cannot be changed directly; use transfer_account_ownership'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: enforce_conversation_assignee_membership(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_conversation_assignee_membership() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.assigned_agent_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.assigned_agent_id IS NOT DISTINCT FROM OLD.assigned_agent_id
     AND NEW.account_id IS NOT DISTINCT FROM OLD.account_id
  THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM profiles
    WHERE user_id = NEW.assigned_agent_id
      AND account_id = NEW.account_id
  ) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.account_id IS NOT DISTINCT FROM OLD.account_id
     AND EXISTS (
       SELECT 1 FROM profiles
       WHERE user_id = OLD.assigned_agent_id
         AND account_id = OLD.account_id
     )
  THEN
    NEW.assigned_agent_id := OLD.assigned_agent_id;
  ELSE
    NEW.assigned_agent_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: enforce_profile_privilege_columns(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_profile_privilege_columns() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF current_user <> 'authenticated' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION
      'profiles are created by the signup trigger; they cannot be inserted directly'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.account_role IS DISTINCT FROM OLD.account_role
     OR NEW.account_id IS DISTINCT FROM OLD.account_id
  THEN
    RAISE EXCEPTION
      'account_role and account_id cannot be changed directly; use the account member/invitation RPCs'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    phone text NOT NULL,
    name text,
    email text,
    company text,
    avatar_url text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    account_id uuid NOT NULL,
    phone_normalized text GENERATED ALWAYS AS (regexp_replace(phone, '\D'::text, ''::text, 'g'::text)) STORED,
    wa_user_id text,
    wa_parent_user_id text,
    wa_username text
);


--
-- Name: COLUMN contacts.wa_user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contacts.wa_user_id IS 'WhatsApp business-scoped user ID (e.g. "US.13491208655302741918"). Stable per (user, business portfolio) and the primary inbound key when Meta withholds the phone number.';


--
-- Name: COLUMN contacts.wa_parent_user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contacts.wa_parent_user_id IS 'Portfolio-level BSUID (e.g. "US.ENT.11815799212886844830"). Stored for reference; not used as a lookup key.';


--
-- Name: COLUMN contacts.wa_username; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contacts.wa_username IS 'WhatsApp username, without the leading @. Display only — usernames are user-changeable and must never be used as an identity key.';


--
-- Name: filter_contacts_by_tags(uuid[], text, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.filter_contacts_by_tags(p_tag_ids uuid[], p_search text DEFAULT NULL::text, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0) RETURNS TABLE(contact public.contacts, total_count bigint)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  WITH matched AS (
    -- Distinct contacts having ANY of the selected tags (OR),
    -- narrowed by the same name/phone/email search as the list.
    SELECT DISTINCT c.id, c.created_at
    FROM contacts c
    JOIN contact_tags ct ON ct.contact_id = c.id
    WHERE ct.tag_id = ANY(p_tag_ids)
      AND (
        p_search IS NULL
        OR c.name ILIKE '%' || p_search || '%'
        OR c.phone ILIKE '%' || p_search || '%'
        OR c.email ILIKE '%' || p_search || '%'
      )
  ),
  page AS (
    -- count(*) OVER() is evaluated before LIMIT, so it is the full
    -- match total regardless of the page being returned.
    SELECT id, count(*) OVER() AS total_count
    FROM matched
    ORDER BY created_at DESC, id
    LIMIT p_limit OFFSET p_offset
  )
  SELECT c AS contact, page.total_count
  FROM page
  JOIN contacts c ON c.id = page.id
  ORDER BY c.created_at DESC, c.id;
$$;


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_full_name TEXT;
  v_account_id UUID;
BEGIN
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');

  INSERT INTO public.accounts (name, owner_user_id)
  VALUES (COALESCE(NULLIF(v_full_name, ''), NEW.email, 'My account'), NEW.id)
  RETURNING id INTO v_account_id;

  INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role)
  VALUES (NEW.id, v_full_name, NEW.email, v_account_id, 'owner');

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to bootstrap account/profile for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;


--
-- Name: increment_automation_execution_count(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.increment_automation_execution_count(p_automation_id uuid) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  UPDATE automations
  SET
    execution_count = execution_count + 1,
    last_executed_at = NOW()
  WHERE id = p_automation_id;
$$;


--
-- Name: increment_flow_execution_count(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.increment_flow_execution_count(p_flow_id uuid) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  UPDATE flows
  SET
    execution_count = execution_count + 1,
    last_executed_at = NOW()
  WHERE id = p_flow_id;
$$;


--
-- Name: is_account_member(uuid, public.account_role_enum); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_account_member(target_account_id uuid, min_role public.account_role_enum DEFAULT 'viewer'::public.account_role_enum) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM profiles p
    WHERE p.user_id = auth.uid()
      AND p.account_id = target_account_id
      AND CASE p.account_role
            WHEN 'owner'  THEN 4
            WHEN 'admin'  THEN 3
            WHEN 'agent'  THEN 2
            WHEN 'viewer' THEN 1
          END
        >=
          CASE min_role
            WHEN 'owner'  THEN 4
            WHEN 'admin'  THEN 3
            WHEN 'agent'  THEN 2
            WHEN 'viewer' THEN 1
          END
  );
$$;


--
-- Name: lead_days_in_stage(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.lead_days_in_stage(p_lead_id uuid) RETURNS integer
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date - (max(entered_at) AT TIME ZONE 'Asia/Kolkata')::date
  FROM lead_stage_history WHERE lead_id = p_lead_id;
$$;


--
-- Name: list_timed_out_flow_runs(timestamp with time zone, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_timed_out_flow_runs(p_now timestamp with time zone, p_limit integer) RETURNS TABLE(id uuid, last_advanced_at timestamp with time zone, fallback_policy jsonb)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT r.id, r.last_advanced_at, f.fallback_policy
  FROM flow_runs r
  LEFT JOIN flows f ON f.id = r.flow_id
  WHERE r.status = 'active'
    AND r.last_advanced_at <= p_now - make_interval(secs => 3600 * (
      CASE
        WHEN jsonb_typeof(f.fallback_policy->'on_timeout_hours') = 'number'
          AND (f.fallback_policy->>'on_timeout_hours')::NUMERIC > 0
        THEN LEAST((f.fallback_policy->>'on_timeout_hours')::NUMERIC, 87600)
        ELSE 24
      END
    )::DOUBLE PRECISION)
  ORDER BY r.last_advanced_at, r.id
  LIMIT GREATEST(p_limit, 0);
$$;


--
-- Name: match_ai_knowledge_fts(uuid, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.match_ai_knowledge_fts(p_account_id uuid, p_query text, p_match_count integer) RETURNS TABLE(id uuid, content text, rank real)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  WITH any_term AS (
    SELECT string_agg(
             '''' || replace(replace(lexeme, '\', '\\'), '''', '''''') || '''',
             ' | '
           )::tsquery AS query
    FROM unnest(tsvector_to_array(to_tsvector('simple', coalesce(p_query, '')))) AS lexeme
  )
  SELECT c.id,
         c.content,
         ts_rank(c.fts, any_term.query) AS rank
  FROM ai_knowledge_chunks c
  CROSS JOIN any_term
  WHERE any_term.query IS NOT NULL
    AND c.account_id = p_account_id
    AND c.fts @@ any_term.query
  ORDER BY rank DESC
  LIMIT GREATEST(p_match_count, 0);
$$;


--
-- Name: match_ai_knowledge_semantic(uuid, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.match_ai_knowledge_semantic(p_account_id uuid, p_query_embedding text, p_match_count integer) RETURNS TABLE(id uuid, content text, distance real)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  SELECT c.id,
         c.content,
         (c.embedding <=> p_query_embedding::vector(1536)) AS distance
  FROM ai_knowledge_chunks c
  WHERE c.account_id = p_account_id
    AND c.embedding IS NOT NULL
  ORDER BY c.embedding <=> p_query_embedding::vector(1536)
  LIMIT GREATEST(p_match_count, 0);
$$;


--
-- Name: merge_duplicate_contacts(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.merge_duplicate_contacts() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_group   RECORD;
  v_survivor UUID;
  v_losers   UUID[];
  v_merged   INTEGER := 0;
BEGIN
  FOR v_group IN
    SELECT account_id,
           phone_normalized,
           array_agg(id ORDER BY created_at ASC, id ASC) AS ids
    FROM contacts
    WHERE phone_normalized <> ''
    GROUP BY account_id, phone_normalized
    HAVING count(*) > 1
  LOOP
    v_survivor := v_group.ids[1];
    v_losers   := v_group.ids[2:array_length(v_group.ids, 1)];

    -- Plain re-point: these tables have no contact-scoped unique
    -- constraint. `conversations` is ON DELETE CASCADE, so this
    -- re-point is what saves its rows (and their messages) from
    -- being deleted with the loser contact.
    UPDATE conversations                 SET contact_id = v_survivor WHERE contact_id = ANY(v_losers);
    UPDATE contact_notes                 SET contact_id = v_survivor WHERE contact_id = ANY(v_losers);
    UPDATE deals                         SET contact_id = v_survivor WHERE contact_id = ANY(v_losers);
    UPDATE broadcast_recipients          SET contact_id = v_survivor WHERE contact_id = ANY(v_losers);
    UPDATE automation_logs               SET contact_id = v_survivor WHERE contact_id = ANY(v_losers);
    UPDATE automation_pending_executions SET contact_id = v_survivor WHERE contact_id = ANY(v_losers);

    -- Conflict-guarded re-point for UNIQUE(contact_id, tag_id):
    -- move only tags the survivor doesn't already have, drop the rest.
    UPDATE contact_tags ct SET contact_id = v_survivor
      WHERE ct.contact_id = ANY(v_losers)
        AND NOT EXISTS (
          SELECT 1 FROM contact_tags s
          WHERE s.contact_id = v_survivor AND s.tag_id = ct.tag_id
        );
    DELETE FROM contact_tags WHERE contact_id = ANY(v_losers);

    -- Same guard for UNIQUE(contact_id, custom_field_id). Survivor's
    -- own value wins on conflict.
    UPDATE contact_custom_values cv SET contact_id = v_survivor
      WHERE cv.contact_id = ANY(v_losers)
        AND NOT EXISTS (
          SELECT 1 FROM contact_custom_values s
          WHERE s.contact_id = v_survivor AND s.custom_field_id = cv.custom_field_id
        );
    DELETE FROM contact_custom_values WHERE contact_id = ANY(v_losers);

    -- flow_runs has a partial UNIQUE on active runs per contact.
    -- Re-point only NON-active runs (exempt from the partial index)
    -- to preserve history; any active loser run is left to be
    -- NULLed by its FK's ON DELETE SET NULL when the loser is
    -- removed below — avoids colliding with the survivor's active run.
    UPDATE flow_runs SET contact_id = v_survivor
      WHERE contact_id = ANY(v_losers) AND status <> 'active';

    DELETE FROM contacts WHERE id = ANY(v_losers);

    v_merged := v_merged + COALESCE(array_length(v_losers, 1), 0);
  END LOOP;

  RETURN v_merged;
END;
$$;


--
-- Name: merge_duplicate_conversations(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.merge_duplicate_conversations() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_group    RECORD;
  v_survivor UUID;
  v_losers   UUID[];
  v_all      UUID[];
  v_merged   INTEGER := 0;
BEGIN
  FOR v_group IN
    SELECT account_id,
           contact_id,
           array_agg(id ORDER BY created_at ASC, id ASC) AS ids,
           COALESCE(SUM(unread_count), 0)                AS total_unread
    FROM conversations
    GROUP BY account_id, contact_id
    HAVING count(*) > 1
  LOOP
    v_all      := v_group.ids;
    v_survivor := v_all[1];
    v_losers   := v_all[2:array_length(v_all, 1)];

    -- Re-point every conversation-scoped child from the losers onto
    -- the survivor. None of these carry a conversation-scoped unique
    -- constraint (message_id is intentionally non-unique — see
    -- migration 009), so a plain UPDATE is safe. Doing this BEFORE the
    -- delete is what saves the ON DELETE CASCADE children (messages,
    -- message_reactions, notifications) from being removed with the
    -- loser conversations.
    UPDATE messages          SET conversation_id = v_survivor WHERE conversation_id = ANY(v_losers);
    UPDATE message_reactions SET conversation_id = v_survivor WHERE conversation_id = ANY(v_losers);
    UPDATE deals             SET conversation_id = v_survivor WHERE conversation_id = ANY(v_losers);
    UPDATE flow_runs         SET conversation_id = v_survivor WHERE conversation_id = ANY(v_losers);
    UPDATE notifications     SET conversation_id = v_survivor WHERE conversation_id = ANY(v_losers);
    UPDATE ai_usage_log      SET conversation_id = v_survivor WHERE conversation_id = ANY(v_losers);

    -- Roll the merged unread counts onto the survivor and re-derive
    -- its last-message summary from the now-complete message set, so
    -- the surviving thread reflects the full history.
    UPDATE conversations c
    SET unread_count      = v_group.total_unread,
        last_message_text = lm.content_text,
        last_message_at   = lm.created_at,
        updated_at        = NOW()
    FROM (
      SELECT content_text, created_at
      FROM messages
      WHERE conversation_id = v_survivor
      ORDER BY created_at DESC
      LIMIT 1
    ) lm
    WHERE c.id = v_survivor;

    -- Survivor may have no messages at all (edge case). Still fold in
    -- the merged unread count in that case.
    UPDATE conversations
    SET unread_count = v_group.total_unread,
        updated_at   = NOW()
    WHERE id = v_survivor
      AND NOT EXISTS (SELECT 1 FROM messages WHERE conversation_id = v_survivor);

    DELETE FROM conversations WHERE id = ANY(v_losers);

    v_merged := v_merged + COALESCE(array_length(v_losers, 1), 0);
  END LOOP;

  RETURN v_merged;
END;
$$;


--
-- Name: message_in_account(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.message_in_account(p_message_id uuid, p_account_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT (current_setting('role', true) IN ('service_role', 'postgres', 'none', '') OR public.is_account_member(p_account_id))
    AND EXISTS (SELECT 1 FROM public.messages m JOIN public.conversations c ON c.id = m.conversation_id
    WHERE m.id = p_message_id AND c.account_id = p_account_id)
$$;


--
-- Name: notify_conversation_assigned(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_conversation_assigned() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_contact_name TEXT;
  v_actor_name TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.assigned_agent_id IS NULL THEN
      RETURN NEW;
    END IF;
  ELSE
    IF NEW.assigned_agent_id IS NULL
       OR NEW.assigned_agent_id IS NOT DISTINCT FROM OLD.assigned_agent_id THEN
      RETURN NEW;
    END IF;
  END IF;

  IF auth.uid() IS NOT NULL AND auth.uid() = NEW.assigned_agent_id THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE user_id = NEW.assigned_agent_id
      AND account_id = NEW.account_id
  ) THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(name, ''), phone) INTO v_contact_name
  FROM contacts WHERE id = NEW.contact_id;

  IF auth.uid() IS NOT NULL THEN
    SELECT full_name INTO v_actor_name
    FROM profiles WHERE user_id = auth.uid();
  END IF;

  INSERT INTO notifications (
    account_id, user_id, type, conversation_id, contact_id,
    actor_user_id, title, body
  ) VALUES (
    NEW.account_id,
    NEW.assigned_agent_id,
    'conversation_assigned',
    NEW.id,
    NEW.contact_id,
    auth.uid(),
    'New conversation assigned',
    COALESCE(v_actor_name, 'Someone') || ' assigned you a conversation with '
      || COALESCE(v_contact_name, 'a contact')
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to create assignment notification for conversation %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;


--
-- Name: peek_invitation(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.peek_invitation(p_token_hash text) RETURNS json
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_inv account_invitations%ROWTYPE;
  v_account_name TEXT;
BEGIN
  SELECT * INTO v_inv
  FROM account_invitations
  WHERE token_hash = p_token_hash;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'reason', 'not_found');
  END IF;

  IF v_inv.accepted_at IS NOT NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'used');
  END IF;

  IF v_inv.expires_at <= NOW() THEN
    RETURN json_build_object('ok', false, 'reason', 'expired');
  END IF;

  SELECT name INTO v_account_name
  FROM accounts
  WHERE id = v_inv.account_id;

  RETURN json_build_object(
    'ok', true,
    'account_name', v_account_name,
    'role', v_inv.role,
    'expires_at', v_inv.expires_at
  );
END;
$$;


--
-- Name: recompute_broadcast_counts(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recompute_broadcast_counts(bid uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  UPDATE broadcasts b SET
    sent_count      = agg.sent_count,
    delivered_count = agg.delivered_count,
    read_count      = agg.read_count,
    replied_count   = agg.replied_count,
    failed_count    = agg.failed_count,
    updated_at      = NOW()
  FROM (
    SELECT
      COUNT(*) FILTER (WHERE status IN ('sent','delivered','read','replied')) AS sent_count,
      COUNT(*) FILTER (WHERE status IN ('delivered','read','replied'))        AS delivered_count,
      COUNT(*) FILTER (WHERE status IN ('read','replied'))                    AS read_count,
      COUNT(*) FILTER (WHERE status = 'replied')                              AS replied_count,
      COUNT(*) FILTER (WHERE status = 'failed')                               AS failed_count
    FROM broadcast_recipients
    WHERE broadcast_id = bid
  ) agg
  WHERE b.id = bid;
END;
$$;


--
-- Name: record_first_stage(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_first_stage() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  INSERT INTO lead_stage_history (account_id, lead_id, stage_id, moved_by)
  SELECT NEW.account_id, NEW.id, d.stage_id, auth.uid() FROM deals d WHERE d.id = NEW.deal_id;
  RETURN NULL;
END;
$$;


--
-- Name: record_stage_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_stage_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  INSERT INTO lead_stage_history (account_id, lead_id, stage_id, moved_by)
  SELECT l.account_id, l.id, NEW.stage_id, auth.uid() FROM leads l WHERE l.deal_id = NEW.id;
  RETURN NULL;
END;
$$;


--
-- Name: record_webhook_failure(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_webhook_failure(endpoint_id uuid, max_failures integer) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  UPDATE webhook_endpoints
  SET failure_count = failure_count + 1,
      is_active = CASE
        WHEN failure_count + 1 >= max_failures THEN false
        ELSE is_active
      END
  WHERE id = endpoint_id;
$$;


--
-- Name: redeem_invitation(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.redeem_invitation(p_token_hash text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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


--
-- Name: remove_account_member(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.remove_account_member(p_user_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_caller_account_id UUID;
  v_caller_role account_role_enum;
  v_target_account_id UUID;
  v_target_role account_role_enum;
  v_target_name TEXT;
  v_target_email TEXT;
  v_new_account_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM profiles
  WHERE user_id IN (auth.uid(), p_user_id)
  ORDER BY user_id
  FOR UPDATE;

  SELECT account_id, account_role
  INTO v_caller_account_id, v_caller_role
  FROM profiles
  WHERE user_id = auth.uid();

  IF v_caller_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no account' USING ERRCODE = '42501';
  END IF;

  IF v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'This action requires the admin role or higher'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot remove yourself; transfer ownership or leave the account instead'
      USING ERRCODE = '22023';
  END IF;

  SELECT account_id, account_role, full_name, email
  INTO v_target_account_id, v_target_role, v_target_name, v_target_email
  FROM profiles
  WHERE user_id = p_user_id;

  IF v_target_account_id IS NULL THEN
    RAISE EXCEPTION 'Target user not found' USING ERRCODE = '22023';
  END IF;

  IF v_target_account_id <> v_caller_account_id THEN
    RAISE EXCEPTION 'Target user is not a member of your account'
      USING ERRCODE = '42501';
  END IF;

  IF v_target_role = 'owner' THEN
    RAISE EXCEPTION 'Cannot remove the account owner; transfer ownership first'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO accounts (name, owner_user_id)
  VALUES (
    COALESCE(NULLIF(v_target_name, ''), v_target_email, 'My account'),
    p_user_id
  )
  RETURNING id INTO v_new_account_id;

  UPDATE profiles
  SET account_id = v_new_account_id,
      account_role = 'owner'
  WHERE user_id = p_user_id;

  UPDATE conversations
  SET assigned_agent_id = NULL
  WHERE account_id = v_target_account_id
    AND assigned_agent_id = p_user_id;

  RETURN v_new_account_id;
END;
$$;


--
-- Name: renew_broadcast_delivery_lease(uuid, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.renew_broadcast_delivery_lease(p_broadcast_id uuid, p_held timestamp with time zone) RETURNS timestamp with time zone
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_lease TIMESTAMPTZ;
BEGIN
  UPDATE broadcasts b
  SET delivery_lease_until = now() + INTERVAL '5 minutes'
  WHERE b.id = p_broadcast_id
    AND is_account_member(b.account_id, 'agent')
    AND b.delivery_lease_until = p_held
  RETURNING b.delivery_lease_until INTO v_lease;
  RETURN v_lease;
END;
$$;


--
-- Name: replace_flow_graph(uuid, jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.replace_flow_graph(p_flow_id uuid, p_nodes jsonb, p_flow jsonb) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_cancelled INTEGER;
BEGIN
  IF p_flow IS NULL OR jsonb_typeof(p_flow) <> 'object' THEN
    RAISE EXCEPTION 'p_flow must be a JSON object' USING ERRCODE = '22023';
  END IF;

  v_cancelled := replace_flow_nodes(p_flow_id, p_nodes);

  UPDATE flows
  SET name = CASE WHEN p_flow ? 'name' THEN p_flow->>'name' ELSE name END,
      description = CASE WHEN p_flow ? 'description' THEN p_flow->>'description' ELSE description END,
      trigger_type = CASE WHEN p_flow ? 'trigger_type' THEN p_flow->>'trigger_type' ELSE trigger_type END,
      trigger_config = CASE WHEN p_flow ? 'trigger_config' THEN p_flow->'trigger_config' ELSE trigger_config END,
      entry_node_id = CASE WHEN p_flow ? 'entry_node_id' THEN p_flow->>'entry_node_id' ELSE entry_node_id END,
      fallback_policy = CASE WHEN p_flow ? 'fallback_policy' THEN p_flow->'fallback_policy' ELSE fallback_policy END,
      updated_at = NOW()
  WHERE id = p_flow_id;

  RETURN v_cancelled;
END;
$$;


--
-- Name: replace_flow_nodes(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.replace_flow_nodes(p_flow_id uuid, p_nodes jsonb) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_account_id UUID;
  v_cancelled INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_nodes IS NULL OR jsonb_typeof(p_nodes) <> 'array' THEN
    RAISE EXCEPTION 'p_nodes must be a JSON array' USING ERRCODE = '22023';
  END IF;

  SELECT account_id INTO v_account_id
  FROM flows
  WHERE id = p_flow_id
  FOR UPDATE;

  IF v_account_id IS NULL OR NOT is_account_member(v_account_id, 'agent') THEN
    RAISE EXCEPTION 'Flow not found' USING ERRCODE = '42501';
  END IF;

  DELETE FROM flow_nodes WHERE flow_id = p_flow_id;

  INSERT INTO flow_nodes (flow_id, node_key, node_type, config, position_x, position_y)
  SELECT
    p_flow_id,
    n->>'node_key',
    n->>'node_type',
    COALESCE(n->'config', '{}'::jsonb),
    COALESCE((n->>'position_x')::INTEGER, 0),
    COALESCE((n->>'position_y')::INTEGER, 0)
  FROM jsonb_array_elements(p_nodes) AS n;

  UPDATE flow_runs r
  SET status = 'cancelled',
      ended_at = NOW(),
      end_reason = 'current_node_removed'
  WHERE r.flow_id = p_flow_id
    AND r.status = 'active'
    AND NOT EXISTS (
      SELECT 1 FROM flow_nodes fn
      WHERE fn.flow_id = p_flow_id
        AND fn.node_key = r.current_node_key
    );
  GET DIAGNOSTICS v_cancelled = ROW_COUNT;

  RETURN v_cancelled;
END;
$$;


--
-- Name: set_member_role(uuid, public.account_role_enum); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_member_role(p_user_id uuid, p_new_role public.account_role_enum) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_caller_account_id UUID;
  v_caller_role account_role_enum;
  v_target_account_id UUID;
  v_target_role account_role_enum;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM profiles
  WHERE user_id IN (auth.uid(), p_user_id)
  ORDER BY user_id
  FOR UPDATE;

  SELECT account_id, account_role
  INTO v_caller_account_id, v_caller_role
  FROM profiles
  WHERE user_id = auth.uid();

  IF v_caller_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no account' USING ERRCODE = '42501';
  END IF;

  IF v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'This action requires the admin role or higher'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot change your own role'
      USING ERRCODE = '22023';
  END IF;

  SELECT account_id, account_role
  INTO v_target_account_id, v_target_role
  FROM profiles
  WHERE user_id = p_user_id;

  IF v_target_account_id IS NULL THEN
    RAISE EXCEPTION 'Target user not found' USING ERRCODE = '22023';
  END IF;

  IF v_target_account_id <> v_caller_account_id THEN
    RAISE EXCEPTION 'Target user is not a member of your account'
      USING ERRCODE = '42501';
  END IF;

  IF v_target_role = 'owner' THEN
    RAISE EXCEPTION 'Use transfer_account_ownership to demote an owner'
      USING ERRCODE = '22023';
  END IF;
  IF p_new_role = 'owner' THEN
    RAISE EXCEPTION 'Use transfer_account_ownership to promote to owner'
      USING ERRCODE = '22023';
  END IF;

  UPDATE profiles
  SET account_role = p_new_role
  WHERE user_id = p_user_id;
END;
$$;


--
-- Name: stamp_conversation_closed_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.stamp_conversation_closed_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.status <> 'closed' THEN
    NEW.closed_at := NULL;
  ELSIF TG_OP = 'INSERT' THEN
    NEW.closed_at := COALESCE(NEW.closed_at, now());
  ELSIF OLD.status IS DISTINCT FROM 'closed' THEN
    NEW.closed_at := now();
  ELSE
    NEW.closed_at := COALESCE(OLD.closed_at, now());
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: stamp_deal_closed_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.stamp_deal_closed_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.status NOT IN ('won', 'lost') THEN
    NEW.closed_at := NULL;
  ELSIF TG_OP = 'INSERT' THEN
    NEW.closed_at := COALESCE(NEW.closed_at, now());
  ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
    NEW.closed_at := now();
  ELSE
    NEW.closed_at := COALESCE(OLD.closed_at, now());
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: sync_deal_status(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_deal_status() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_status text := CASE WHEN NEW.admitted_at IS NOT NULL THEN 'won' WHEN NEW.exit IS NOT NULL THEN 'lost' ELSE 'open' END;
BEGIN
  UPDATE deals SET status = v_status WHERE id = NEW.deal_id AND status IS DISTINCT FROM v_status;
  RETURN NULL;
END;
$$;


--
-- Name: sync_lead_contact(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_lead_contact() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.leads WHERE deal_id = NEW.id) THEN
    IF NEW.account_id IS DISTINCT FROM OLD.account_id THEN
      RAISE EXCEPTION 'A deal with a lead cannot move to another account' USING ERRCODE = '23514';
    END IF;
    IF NEW.contact_id IS NULL THEN
      RAISE EXCEPTION 'A deal with a lead must keep its contact' USING ERRCODE = '23514';
    END IF;
    UPDATE public.leads SET contact_id = NEW.contact_id WHERE deal_id = NEW.id AND contact_id IS DISTINCT FROM NEW.contact_id;
  END IF;
  RETURN NULL;
END $$;


--
-- Name: touch_presence(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.touch_presence(p_status text DEFAULT 'online'::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_account_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_status NOT IN ('online', 'away') THEN
    RAISE EXCEPTION 'Invalid presence status: %', p_status
      USING ERRCODE = '22023';
  END IF;

  SELECT account_id INTO v_account_id
  FROM profiles
  WHERE user_id = auth.uid();

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'No account for caller' USING ERRCODE = '22023';
  END IF;

  INSERT INTO member_presence (user_id, account_id, status, last_seen_at)
  VALUES (auth.uid(), v_account_id, p_status, now())
  ON CONFLICT (user_id) DO UPDATE
    SET status       = excluded.status,
        last_seen_at = now(),
        account_id   = excluded.account_id;
END;
$$;


--
-- Name: track_conversation_message_times(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.track_conversation_message_times() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.sender_type = 'customer' THEN
      UPDATE conversations
      SET last_inbound_at = GREATEST(COALESCE(last_inbound_at, NEW.created_at), NEW.created_at)
      WHERE id = NEW.conversation_id;
    ELSIF (NEW.sender_type = 'agent' OR NEW.ai_generated) AND NEW.status IS DISTINCT FROM 'failed' THEN
      UPDATE conversations
      SET last_reply_at = GREATEST(COALESCE(last_reply_at, NEW.created_at), NEW.created_at)
      WHERE id = NEW.conversation_id;
    END IF;
  ELSIF NEW.status = 'failed'
    AND OLD.status IS DISTINCT FROM 'failed'
    AND (NEW.sender_type = 'agent' OR NEW.ai_generated) THEN
    UPDATE conversations
    SET last_reply_at = (
      SELECT max(m.created_at)
      FROM messages m
      WHERE m.conversation_id = NEW.conversation_id
        AND (m.sender_type = 'agent' OR m.ai_generated)
        AND m.status <> 'failed'
    )
    WHERE id = NEW.conversation_id;
  END IF;
  RETURN NULL;
END;
$$;


--
-- Name: transfer_account_ownership(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.transfer_account_ownership(p_new_owner_user_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_caller_account_id UUID;
  v_caller_role account_role_enum;
  v_target_account_id UUID;
  v_target_role account_role_enum;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM profiles
  WHERE user_id IN (auth.uid(), p_new_owner_user_id)
  ORDER BY user_id
  FOR UPDATE;

  SELECT account_id, account_role
  INTO v_caller_account_id, v_caller_role
  FROM profiles
  WHERE user_id = auth.uid();

  IF v_caller_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no account' USING ERRCODE = '42501';
  END IF;

  IF v_caller_role <> 'owner' THEN
    RAISE EXCEPTION 'Only the account owner can transfer ownership'
      USING ERRCODE = '42501';
  END IF;

  IF p_new_owner_user_id = auth.uid() THEN
    RAISE EXCEPTION 'You are already the owner'
      USING ERRCODE = '22023';
  END IF;

  SELECT account_id, account_role
  INTO v_target_account_id, v_target_role
  FROM profiles
  WHERE user_id = p_new_owner_user_id;

  IF v_target_account_id IS NULL THEN
    RAISE EXCEPTION 'Target user not found' USING ERRCODE = '22023';
  END IF;

  IF v_target_account_id <> v_caller_account_id THEN
    RAISE EXCEPTION 'Target user is not a member of your account'
      USING ERRCODE = '42501';
  END IF;

  UPDATE profiles SET account_role = 'admin'
  WHERE user_id = auth.uid();

  UPDATE profiles SET account_role = 'owner'
  WHERE user_id = p_new_owner_user_id;

  UPDATE accounts SET owner_user_id = p_new_owner_user_id
  WHERE id = v_caller_account_id;
END;
$$;


--
-- Name: update_ai_configs_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_ai_configs_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: update_ai_knowledge_documents_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_ai_knowledge_documents_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: account_invitations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account_invitations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    token_hash text NOT NULL,
    role public.account_role_enum NOT NULL,
    created_by_user_id uuid,
    label text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    accepted_at timestamp with time zone,
    accepted_by_user_id uuid,
    CONSTRAINT account_invitations_role_check CHECK ((role <> 'owner'::public.account_role_enum))
);


--
-- Name: accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    owner_user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    default_currency text DEFAULT 'USD'::text NOT NULL,
    reply_target_minutes integer DEFAULT 5 NOT NULL,
    CONSTRAINT accounts_default_currency_format CHECK ((default_currency ~ '^[A-Z]{3}$'::text)),
    CONSTRAINT accounts_reply_target_minutes_range CHECK (((reply_target_minutes >= 1) AND (reply_target_minutes <= 1440)))
);


--
-- Name: admissions_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admissions_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    kind public.admissions_setting_kind NOT NULL,
    key text NOT NULL,
    label text NOT NULL,
    value jsonb DEFAULT '{}'::jsonb NOT NULL,
    active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT admissions_settings_alert_value CHECK (((kind <> 'alert'::public.admissions_setting_kind) OR ((jsonb_typeof((value -> 'threshold'::text)) = 'number'::text) AND (((value ->> 'threshold'::text))::numeric >= (0)::numeric)))),
    CONSTRAINT admissions_settings_follow_up_rule_value CHECK (((kind <> 'follow_up_rule'::public.admissions_setting_kind) OR ((jsonb_typeof((value -> 'stage'::text)) = 'string'::text) AND (jsonb_typeof((value -> 'days'::text)) = 'number'::text) AND ((value ->> 'days'::text) ~ '^[0-9]+$'::text) AND ((value ->> 'action'::text) = ANY (ARRAY['send_template'::text, 'call_task'::text, 'dormant'::text])) AND (((value ->> 'action'::text) <> 'send_template'::text) OR (jsonb_typeof((value -> 'template'::text)) = 'string'::text))))),
    CONSTRAINT admissions_settings_key_check CHECK ((key ~ '^[a-z0-9_]+$'::text)),
    CONSTRAINT admissions_settings_label_check CHECK ((btrim(label) <> ''::text)),
    CONSTRAINT admissions_settings_value_check CHECK ((jsonb_typeof(value) = 'object'::text))
);


--
-- Name: ai_configs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_configs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    created_by uuid,
    provider text NOT NULL,
    model text NOT NULL,
    api_key text NOT NULL,
    system_prompt text,
    is_active boolean DEFAULT false NOT NULL,
    auto_reply_enabled boolean DEFAULT false NOT NULL,
    auto_reply_max_per_conversation integer DEFAULT 3 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    embeddings_api_key text,
    handoff_agent_id uuid,
    base_url text,
    CONSTRAINT ai_configs_auto_reply_max_per_conversation_check CHECK (((auto_reply_max_per_conversation >= 1) AND (auto_reply_max_per_conversation <= 20))),
    CONSTRAINT ai_configs_openai_compatible_base_url_check CHECK (((provider <> 'openai_compatible'::text) OR ((base_url IS NOT NULL) AND (btrim(base_url) <> ''::text)))),
    CONSTRAINT ai_configs_provider_check CHECK ((provider = ANY (ARRAY['openai'::text, 'anthropic'::text, 'openai_compatible'::text])))
);


--
-- Name: ai_knowledge_chunks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_knowledge_chunks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    document_id uuid NOT NULL,
    account_id uuid NOT NULL,
    chunk_index integer DEFAULT 0 NOT NULL,
    content text NOT NULL,
    fts tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, content)) STORED,
    embedding public.vector(1536),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ai_knowledge_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_knowledge_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    created_by uuid,
    title text NOT NULL,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ai_usage_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_usage_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    conversation_id uuid,
    mode text NOT NULL,
    provider text NOT NULL,
    model text NOT NULL,
    prompt_tokens integer DEFAULT 0 NOT NULL,
    completion_tokens integer DEFAULT 0 NOT NULL,
    total_tokens integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ai_usage_log_mode_check CHECK ((mode = ANY (ARRAY['auto_reply'::text, 'draft'::text]))),
    CONSTRAINT ai_usage_log_provider_check CHECK ((provider = ANY (ARRAY['openai'::text, 'anthropic'::text, 'openai_compatible'::text])))
);


--
-- Name: api_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.api_keys (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    created_by uuid,
    name text NOT NULL,
    key_prefix text NOT NULL,
    key_hash text NOT NULL,
    scopes text[] DEFAULT '{}'::text[] NOT NULL,
    last_used_at timestamp with time zone,
    expires_at timestamp with time zone,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: automation_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automation_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    automation_id uuid NOT NULL,
    user_id uuid NOT NULL,
    contact_id uuid,
    trigger_event text NOT NULL,
    steps_executed jsonb DEFAULT '[]'::jsonb NOT NULL,
    status text NOT NULL,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    account_id uuid NOT NULL,
    CONSTRAINT automation_logs_status_check CHECK ((status = ANY (ARRAY['success'::text, 'partial'::text, 'failed'::text])))
);


--
-- Name: automation_pending_executions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automation_pending_executions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    automation_id uuid NOT NULL,
    user_id uuid NOT NULL,
    contact_id uuid,
    log_id uuid,
    parent_step_id uuid,
    branch text,
    next_step_position integer NOT NULL,
    context jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    run_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    account_id uuid NOT NULL,
    claimed_at timestamp with time zone,
    parked_step_id uuid,
    CONSTRAINT automation_pending_executions_branch_check CHECK ((branch = ANY (ARRAY['yes'::text, 'no'::text]))),
    CONSTRAINT automation_pending_executions_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'done'::text, 'failed'::text, 'awaiting_reply'::text, 'expired'::text, 'superseded'::text])))
);


--
-- Name: automation_steps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automation_steps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    automation_id uuid NOT NULL,
    parent_step_id uuid,
    branch text,
    step_type text NOT NULL,
    step_config jsonb DEFAULT '{}'::jsonb NOT NULL,
    "position" integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT automation_steps_branch_check CHECK ((branch = ANY (ARRAY['yes'::text, 'no'::text])))
);


--
-- Name: automations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    trigger_type text NOT NULL,
    trigger_config jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_active boolean DEFAULT false NOT NULL,
    execution_count integer DEFAULT 0 NOT NULL,
    last_executed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    account_id uuid NOT NULL
);


--
-- Name: broadcast_recipients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.broadcast_recipients (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    broadcast_id uuid NOT NULL,
    contact_id uuid,
    status text DEFAULT 'pending'::text NOT NULL,
    sent_at timestamp with time zone,
    delivered_at timestamp with time zone,
    read_at timestamp with time zone,
    replied_at timestamp with time zone,
    error_message text,
    created_at timestamp with time zone DEFAULT now(),
    whatsapp_message_id text,
    template_params jsonb,
    CONSTRAINT broadcast_recipients_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'delivered'::text, 'read'::text, 'replied'::text, 'failed'::text])))
);


--
-- Name: COLUMN broadcast_recipients.template_params; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.broadcast_recipients.template_params IS 'Positional body values for this recipient''s template send ({{1}}, {{2}}, ...), frozen when the broadcast was planned. NULL on rows created before migration 038; a resume treats that as no params.';


--
-- Name: broadcasts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.broadcasts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    template_name text NOT NULL,
    template_language text DEFAULT 'en_US'::text NOT NULL,
    template_variables jsonb,
    audience_filter jsonb,
    scheduled_at timestamp with time zone,
    status text DEFAULT 'draft'::text NOT NULL,
    total_recipients integer DEFAULT 0,
    sent_count integer DEFAULT 0,
    delivered_count integer DEFAULT 0,
    read_count integer DEFAULT 0,
    replied_count integer DEFAULT 0,
    failed_count integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    account_id uuid NOT NULL,
    delivery_locked_at timestamp with time zone,
    delivery_lease_until timestamp with time zone,
    CONSTRAINT broadcasts_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'scheduled'::text, 'sending'::text, 'sent'::text, 'failed'::text])))
);


--
-- Name: COLUMN broadcasts.delivery_locked_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.broadcasts.delivery_locked_at IS 'Set while a server-side delivery pass is fanning out; NULL when idle. See 038_broadcast_resume.sql.';


--
-- Name: contact_custom_values; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contact_custom_values (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contact_id uuid NOT NULL,
    custom_field_id uuid NOT NULL,
    value text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: contact_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contact_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contact_id uuid NOT NULL,
    user_id uuid NOT NULL,
    note_text text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    account_id uuid NOT NULL
);


--
-- Name: contact_tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contact_tags (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contact_id uuid NOT NULL,
    tag_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    contact_id uuid NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    assigned_agent_id uuid,
    last_message_text text,
    last_message_at timestamp with time zone,
    unread_count integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    account_id uuid NOT NULL,
    ai_autoreply_disabled boolean DEFAULT false NOT NULL,
    ai_reply_count integer DEFAULT 0 NOT NULL,
    ai_handoff_summary text,
    first_inbound_at timestamp with time zone,
    last_inbound_at timestamp with time zone,
    last_reply_at timestamp with time zone,
    closed_at timestamp with time zone,
    CONSTRAINT conversations_status_check CHECK ((status = ANY (ARRAY['open'::text, 'pending'::text, 'closed'::text])))
);


--
-- Name: custom_fields; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.custom_fields (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    field_name text NOT NULL,
    field_type text DEFAULT 'text'::text NOT NULL,
    field_options jsonb,
    created_at timestamp with time zone DEFAULT now(),
    account_id uuid NOT NULL
);


--
-- Name: deals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    pipeline_id uuid NOT NULL,
    stage_id uuid NOT NULL,
    contact_id uuid,
    conversation_id uuid,
    title text NOT NULL,
    value numeric(12,2) DEFAULT 0 NOT NULL,
    currency text DEFAULT 'USD'::text,
    notes text,
    expected_close_date date,
    status text DEFAULT 'open'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    assigned_to uuid,
    account_id uuid NOT NULL,
    closed_at timestamp with time zone,
    CONSTRAINT deals_status_check CHECK ((status = ANY (ARRAY['open'::text, 'won'::text, 'lost'::text])))
);


--
-- Name: flow_nodes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.flow_nodes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    flow_id uuid NOT NULL,
    node_key text NOT NULL,
    node_type text NOT NULL,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    position_x integer DEFAULT 0 NOT NULL,
    position_y integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT flow_nodes_node_type_check CHECK ((node_type = ANY (ARRAY['start'::text, 'send_buttons'::text, 'send_list'::text, 'send_message'::text, 'send_media'::text, 'collect_input'::text, 'condition'::text, 'set_tag'::text, 'handoff'::text, 'http_fetch'::text, 'end'::text])))
);


--
-- Name: flow_run_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.flow_run_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    flow_run_id uuid NOT NULL,
    event_type text NOT NULL,
    node_key text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT flow_run_events_event_type_check CHECK ((event_type = ANY (ARRAY['started'::text, 'node_entered'::text, 'message_sent'::text, 'reply_received'::text, 'fallback_fired'::text, 'handoff'::text, 'timeout'::text, 'error'::text, 'completed'::text])))
);


--
-- Name: flow_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.flow_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    flow_id uuid NOT NULL,
    user_id uuid NOT NULL,
    contact_id uuid,
    conversation_id uuid,
    status text DEFAULT 'active'::text NOT NULL,
    current_node_key text,
    last_prompt_message_id uuid,
    vars jsonb DEFAULT '{}'::jsonb NOT NULL,
    reprompt_count integer DEFAULT 0 NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    last_advanced_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone,
    end_reason text,
    account_id uuid NOT NULL,
    transition_seq integer DEFAULT 0 NOT NULL,
    CONSTRAINT flow_runs_status_check CHECK ((status = ANY (ARRAY['active'::text, 'completed'::text, 'handed_off'::text, 'timed_out'::text, 'paused_by_agent'::text, 'cancelled'::text, 'failed'::text])))
);


--
-- Name: flows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.flows (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    status text DEFAULT 'draft'::text NOT NULL,
    trigger_type text NOT NULL,
    trigger_config jsonb DEFAULT '{}'::jsonb NOT NULL,
    entry_node_id text,
    fallback_policy jsonb DEFAULT '{"on_exhaust": "handoff", "max_reprompts": 2, "on_timeout_hours": 24, "on_unknown_reply": "reprompt"}'::jsonb NOT NULL,
    execution_count integer DEFAULT 0 NOT NULL,
    last_executed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    account_id uuid NOT NULL,
    CONSTRAINT flows_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'active'::text, 'archived'::text]))),
    CONSTRAINT flows_trigger_type_check CHECK ((trigger_type = ANY (ARRAY['keyword'::text, 'first_inbound_message'::text, 'manual'::text])))
);


--
-- Name: lead_activity; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lead_activity (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    lead_id uuid NOT NULL,
    kind public.lead_activity_kind NOT NULL,
    rule_id uuid,
    stage_history_id uuid,
    message_id uuid,
    due_at timestamp with time zone DEFAULT now() NOT NULL,
    done_at timestamp with time zone,
    assigned_to uuid,
    outcome text,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lead_activity_rule_has_entry CHECK (((rule_id IS NULL) OR (stage_history_id IS NOT NULL))),
    CONSTRAINT lead_activity_send_has_rule CHECK (((kind <> 'follow_up_send'::public.lead_activity_kind) OR ((rule_id IS NOT NULL) AND (stage_history_id IS NOT NULL))))
);


--
-- Name: visits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.visits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    lead_id uuid NOT NULL,
    cal_booking_id text NOT NULL,
    starts_at timestamp with time zone NOT NULL,
    campus_id uuid,
    status public.visit_status DEFAULT 'booked'::public.visit_status NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT visits_cal_booking_id_check CHECK ((btrim(cal_booking_id) <> ''::text))
);


--
-- Name: lead_current_visit; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.lead_current_visit WITH (security_invoker='true') AS
 SELECT DISTINCT ON (lead_id) lead_id,
    id AS visit_id,
    account_id,
    cal_booking_id,
    starts_at,
    campus_id,
    status,
    created_at
   FROM public.visits v
  WHERE (status <> ALL (ARRAY['cancelled'::public.visit_status, 'rescheduled'::public.visit_status]))
  ORDER BY lead_id, created_at DESC, id DESC;


--
-- Name: lead_stage_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lead_stage_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    lead_id uuid NOT NULL,
    stage_id uuid NOT NULL,
    entered_at timestamp with time zone DEFAULT now() NOT NULL,
    moved_by uuid
);


--
-- Name: leads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.leads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    deal_id uuid NOT NULL,
    contact_id uuid NOT NULL,
    child_name text,
    child_dob date,
    grade text,
    campus_id uuid,
    area text,
    source_id uuid,
    exit public.lead_exit,
    lost_reason_id uuid,
    exited_at timestamp with time zone,
    admitted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT leads_admitted_or_exited CHECK (((exit IS NULL) OR (admitted_at IS NULL))),
    CONSTRAINT leads_exit_has_time CHECK (((exit IS NULL) = (exited_at IS NULL))),
    CONSTRAINT leads_lost_has_reason CHECK (((NOT (exit IS DISTINCT FROM 'lost'::public.lead_exit)) = (lost_reason_id IS NOT NULL)))
);


--
-- Name: member_presence; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_presence (
    user_id uuid NOT NULL,
    account_id uuid NOT NULL,
    status text DEFAULT 'online'::text NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT member_presence_status_check CHECK ((status = ANY (ARRAY['online'::text, 'away'::text])))
);


--
-- Name: message_reactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.message_reactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    message_id uuid NOT NULL,
    conversation_id uuid NOT NULL,
    actor_type text NOT NULL,
    actor_id uuid,
    emoji text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT message_reactions_actor_type_check CHECK ((actor_type = ANY (ARRAY['customer'::text, 'agent'::text])))
);


--
-- Name: message_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.message_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    category text DEFAULT 'Marketing'::text NOT NULL,
    language text DEFAULT 'en_US'::text,
    header_type text,
    header_content text,
    body_text text NOT NULL,
    footer_text text,
    buttons jsonb,
    status text DEFAULT 'DRAFT'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    sample_values jsonb,
    meta_template_id text,
    rejection_reason text,
    quality_score text,
    header_handle text,
    header_media_url text,
    submission_error text,
    last_submitted_at timestamp with time zone,
    account_id uuid NOT NULL,
    CONSTRAINT message_templates_buttons_shape_check CHECK (((buttons IS NULL) OR ((jsonb_typeof(buttons) = 'array'::text) AND (jsonb_array_length(buttons) <= 10)))),
    CONSTRAINT message_templates_category_check CHECK ((category = ANY (ARRAY['Marketing'::text, 'Utility'::text, 'Authentication'::text]))),
    CONSTRAINT message_templates_header_type_check CHECK ((header_type = ANY (ARRAY['text'::text, 'image'::text, 'video'::text, 'document'::text]))),
    CONSTRAINT message_templates_quality_score_check CHECK (((quality_score IS NULL) OR (quality_score = ANY (ARRAY['GREEN'::text, 'YELLOW'::text, 'RED'::text])))),
    CONSTRAINT message_templates_status_meta_check CHECK ((status = ANY (ARRAY['DRAFT'::text, 'PENDING'::text, 'APPROVED'::text, 'REJECTED'::text, 'PAUSED'::text, 'DISABLED'::text, 'IN_APPEAL'::text, 'PENDING_DELETION'::text])))
);


--
-- Name: messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    sender_type text NOT NULL,
    sender_id uuid,
    content_type text DEFAULT 'text'::text NOT NULL,
    content_text text,
    media_url text,
    template_name text,
    message_id text,
    status text DEFAULT 'sent'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    reply_to_message_id uuid,
    interactive_reply_id text,
    ai_generated boolean DEFAULT false NOT NULL,
    interactive_payload jsonb,
    media_type text,
    error_code integer,
    error_title text,
    error_details text,
    CONSTRAINT messages_content_type_check CHECK ((content_type = ANY (ARRAY['text'::text, 'image'::text, 'document'::text, 'audio'::text, 'video'::text, 'location'::text, 'template'::text, 'interactive'::text]))),
    CONSTRAINT messages_sender_type_check CHECK ((sender_type = ANY (ARRAY['customer'::text, 'agent'::text, 'bot'::text]))),
    CONSTRAINT messages_status_check CHECK ((status = ANY (ARRAY['sending'::text, 'sent'::text, 'delivered'::text, 'read'::text, 'failed'::text])))
);


--
-- Name: COLUMN messages.media_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.messages.media_type IS 'MIME type of media_url''s content, as reported by Meta. Populated for INBOUND media only: an outbound media_url is a chat-media object whose path already carries the original filename and extension, so the type adds nothing there. Also NULL for text messages and for every row written before migration 039.';


--
-- Name: COLUMN messages.error_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.messages.error_code IS 'Meta''s numeric error code for this message (errors[0].code): from a failed status on an outbound message, or from a `type: unsupported` delivery on an inbound one. NULL when Meta reported no error. Not cleared by a later status update.';


--
-- Name: COLUMN messages.error_title; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.messages.error_title IS 'Meta''s short error label for this message (errors[0].title). NULL when Meta reported no error. See messages.error_code for when it is set.';


--
-- Name: COLUMN messages.error_details; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.messages.error_details IS 'Meta''s human-readable explanation for this message (errors[0].error_data.details, falling back to errors[0].message). NULL when Meta reported no error or supplied no explanation.';


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    user_id uuid NOT NULL,
    type text DEFAULT 'conversation_assigned'::text NOT NULL,
    conversation_id uuid,
    contact_id uuid,
    actor_user_id uuid,
    title text NOT NULL,
    body text,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT notifications_type_check CHECK ((type = 'conversation_assigned'::text))
);

ALTER TABLE ONLY public.notifications REPLICA IDENTITY FULL;


--
-- Name: pending_message_statuses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pending_message_statuses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    wamid text NOT NULL,
    status text NOT NULL,
    error_code integer,
    error_title text,
    error_details text,
    status_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: pipeline_stages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pipeline_stages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    pipeline_id uuid NOT NULL,
    name text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    color text DEFAULT '#3b82f6'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: pipelines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pipelines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    account_id uuid NOT NULL
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    full_name text NOT NULL,
    email text NOT NULL,
    avatar_url text,
    role text DEFAULT 'user'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    beta_features text[] DEFAULT ARRAY[]::text[] NOT NULL,
    account_id uuid NOT NULL,
    account_role public.account_role_enum NOT NULL
);


--
-- Name: quick_replies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quick_replies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    user_id uuid NOT NULL,
    title text NOT NULL,
    kind text DEFAULT 'text'::text NOT NULL,
    content_text text,
    interactive_payload jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT quick_replies_kind_check CHECK ((kind = ANY (ARRAY['text'::text, 'interactive'::text])))
);


--
-- Name: settings_changes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settings_changes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    setting_id uuid NOT NULL,
    kind public.admissions_setting_kind NOT NULL,
    key text NOT NULL,
    action public.settings_change_action NOT NULL,
    old_value jsonb,
    new_value jsonb,
    changed_by uuid,
    changed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tags (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    color text DEFAULT '#3b82f6'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    account_id uuid NOT NULL
);


--
-- Name: webhook_endpoints; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.webhook_endpoints (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    created_by uuid,
    url text NOT NULL,
    secret text NOT NULL,
    events text[] DEFAULT '{}'::text[] NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    last_delivery_at timestamp with time zone,
    failure_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: whatsapp_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.whatsapp_config (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    phone_number_id text NOT NULL,
    waba_id text,
    access_token text NOT NULL,
    verify_token text,
    status text DEFAULT 'disconnected'::text NOT NULL,
    connected_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    registered_at timestamp with time zone,
    subscribed_apps_at timestamp with time zone,
    last_registration_error text,
    account_id uuid NOT NULL,
    mirror_inbound_media boolean DEFAULT true NOT NULL,
    CONSTRAINT whatsapp_config_status_check CHECK ((status = ANY (ARRAY['connected'::text, 'disconnected'::text])))
);


--
-- Name: COLUMN whatsapp_config.mirror_inbound_media; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.whatsapp_config.mirror_inbound_media IS 'When true (default), the inbound webhook copies received media into the chat-media bucket so it outlives Meta''s ~30-day retention. Turn off to keep storage flat and accept that attachments expire.';


--
-- Name: account_invitations account_invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_invitations
    ADD CONSTRAINT account_invitations_pkey PRIMARY KEY (id);


--
-- Name: account_invitations account_invitations_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_invitations
    ADD CONSTRAINT account_invitations_token_hash_key UNIQUE (token_hash);


--
-- Name: accounts accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);


--
-- Name: admissions_settings admissions_settings_account_id_kind_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admissions_settings
    ADD CONSTRAINT admissions_settings_account_id_kind_key_key UNIQUE (account_id, kind, key);


--
-- Name: admissions_settings admissions_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admissions_settings
    ADD CONSTRAINT admissions_settings_pkey PRIMARY KEY (id);


--
-- Name: ai_configs ai_configs_account_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_configs
    ADD CONSTRAINT ai_configs_account_id_key UNIQUE (account_id);


--
-- Name: ai_configs ai_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_configs
    ADD CONSTRAINT ai_configs_pkey PRIMARY KEY (id);


--
-- Name: ai_knowledge_chunks ai_knowledge_chunks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_knowledge_chunks
    ADD CONSTRAINT ai_knowledge_chunks_pkey PRIMARY KEY (id);


--
-- Name: ai_knowledge_documents ai_knowledge_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_knowledge_documents
    ADD CONSTRAINT ai_knowledge_documents_pkey PRIMARY KEY (id);


--
-- Name: ai_usage_log ai_usage_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_usage_log
    ADD CONSTRAINT ai_usage_log_pkey PRIMARY KEY (id);


--
-- Name: api_keys api_keys_key_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_key_hash_key UNIQUE (key_hash);


--
-- Name: api_keys api_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_pkey PRIMARY KEY (id);


--
-- Name: automation_logs automation_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_logs
    ADD CONSTRAINT automation_logs_pkey PRIMARY KEY (id);


--
-- Name: automation_pending_executions automation_pending_executions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_pending_executions
    ADD CONSTRAINT automation_pending_executions_pkey PRIMARY KEY (id);


--
-- Name: automation_steps automation_steps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_steps
    ADD CONSTRAINT automation_steps_pkey PRIMARY KEY (id);


--
-- Name: automations automations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automations
    ADD CONSTRAINT automations_pkey PRIMARY KEY (id);


--
-- Name: broadcast_recipients broadcast_recipients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.broadcast_recipients
    ADD CONSTRAINT broadcast_recipients_pkey PRIMARY KEY (id);


--
-- Name: broadcasts broadcasts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.broadcasts
    ADD CONSTRAINT broadcasts_pkey PRIMARY KEY (id);


--
-- Name: contact_custom_values contact_custom_values_contact_id_custom_field_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_custom_values
    ADD CONSTRAINT contact_custom_values_contact_id_custom_field_id_key UNIQUE (contact_id, custom_field_id);


--
-- Name: contact_custom_values contact_custom_values_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_custom_values
    ADD CONSTRAINT contact_custom_values_pkey PRIMARY KEY (id);


--
-- Name: contact_notes contact_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_notes
    ADD CONSTRAINT contact_notes_pkey PRIMARY KEY (id);


--
-- Name: contact_tags contact_tags_contact_id_tag_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_tags
    ADD CONSTRAINT contact_tags_contact_id_tag_id_key UNIQUE (contact_id, tag_id);


--
-- Name: contact_tags contact_tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_tags
    ADD CONSTRAINT contact_tags_pkey PRIMARY KEY (id);


--
-- Name: contacts contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_pkey PRIMARY KEY (id);


--
-- Name: conversations conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_pkey PRIMARY KEY (id);


--
-- Name: custom_fields custom_fields_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_fields
    ADD CONSTRAINT custom_fields_pkey PRIMARY KEY (id);


--
-- Name: deals deals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deals
    ADD CONSTRAINT deals_pkey PRIMARY KEY (id);


--
-- Name: flow_nodes flow_nodes_flow_id_node_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flow_nodes
    ADD CONSTRAINT flow_nodes_flow_id_node_key_key UNIQUE (flow_id, node_key);


--
-- Name: flow_nodes flow_nodes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flow_nodes
    ADD CONSTRAINT flow_nodes_pkey PRIMARY KEY (id);


--
-- Name: flow_run_events flow_run_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flow_run_events
    ADD CONSTRAINT flow_run_events_pkey PRIMARY KEY (id);


--
-- Name: flow_runs flow_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flow_runs
    ADD CONSTRAINT flow_runs_pkey PRIMARY KEY (id);


--
-- Name: flows flows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flows
    ADD CONSTRAINT flows_pkey PRIMARY KEY (id);


--
-- Name: lead_activity lead_activity_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_activity
    ADD CONSTRAINT lead_activity_pkey PRIMARY KEY (id);


--
-- Name: lead_stage_history lead_stage_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_stage_history
    ADD CONSTRAINT lead_stage_history_pkey PRIMARY KEY (id);


--
-- Name: leads leads_deal_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_deal_id_key UNIQUE (deal_id);


--
-- Name: leads leads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_pkey PRIMARY KEY (id);


--
-- Name: member_presence member_presence_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_presence
    ADD CONSTRAINT member_presence_pkey PRIMARY KEY (user_id);


--
-- Name: message_reactions message_reactions_message_id_actor_type_actor_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_reactions
    ADD CONSTRAINT message_reactions_message_id_actor_type_actor_id_key UNIQUE (message_id, actor_type, actor_id);


--
-- Name: message_reactions message_reactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_reactions
    ADD CONSTRAINT message_reactions_pkey PRIMARY KEY (id);


--
-- Name: message_templates message_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_templates
    ADD CONSTRAINT message_templates_pkey PRIMARY KEY (id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: pending_message_statuses pending_message_statuses_account_wamid_status_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_message_statuses
    ADD CONSTRAINT pending_message_statuses_account_wamid_status_key UNIQUE (account_id, wamid, status);


--
-- Name: pending_message_statuses pending_message_statuses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_message_statuses
    ADD CONSTRAINT pending_message_statuses_pkey PRIMARY KEY (id);


--
-- Name: pipeline_stages pipeline_stages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipeline_stages
    ADD CONSTRAINT pipeline_stages_pkey PRIMARY KEY (id);


--
-- Name: pipelines pipelines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipelines
    ADD CONSTRAINT pipelines_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_user_id_key UNIQUE (user_id);


--
-- Name: quick_replies quick_replies_content_matches_kind; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.quick_replies
    ADD CONSTRAINT quick_replies_content_matches_kind CHECK ((((kind = 'text'::text) AND (content_text IS NOT NULL) AND (btrim(content_text) <> ''::text)) OR ((kind = 'interactive'::text) AND (interactive_payload IS NOT NULL)))) NOT VALID;


--
-- Name: quick_replies quick_replies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quick_replies
    ADD CONSTRAINT quick_replies_pkey PRIMARY KEY (id);


--
-- Name: settings_changes settings_changes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings_changes
    ADD CONSTRAINT settings_changes_pkey PRIMARY KEY (id);


--
-- Name: tags tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_pkey PRIMARY KEY (id);


--
-- Name: visits visits_cal_booking_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visits
    ADD CONSTRAINT visits_cal_booking_id_key UNIQUE (cal_booking_id);


--
-- Name: visits visits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visits
    ADD CONSTRAINT visits_pkey PRIMARY KEY (id);


--
-- Name: webhook_endpoints webhook_endpoints_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_endpoints
    ADD CONSTRAINT webhook_endpoints_pkey PRIMARY KEY (id);


--
-- Name: whatsapp_config whatsapp_config_account_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_config
    ADD CONSTRAINT whatsapp_config_account_id_key UNIQUE (account_id);


--
-- Name: whatsapp_config whatsapp_config_phone_number_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_config
    ADD CONSTRAINT whatsapp_config_phone_number_id_key UNIQUE (phone_number_id);


--
-- Name: whatsapp_config whatsapp_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_config
    ADD CONSTRAINT whatsapp_config_pkey PRIMARY KEY (id);


--
-- Name: ai_knowledge_chunks_account_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_knowledge_chunks_account_id_idx ON public.ai_knowledge_chunks USING btree (account_id);


--
-- Name: ai_knowledge_chunks_document_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_knowledge_chunks_document_id_idx ON public.ai_knowledge_chunks USING btree (document_id);


--
-- Name: ai_knowledge_chunks_embedding_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_knowledge_chunks_embedding_idx ON public.ai_knowledge_chunks USING hnsw (embedding public.vector_cosine_ops);


--
-- Name: ai_knowledge_chunks_fts_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_knowledge_chunks_fts_idx ON public.ai_knowledge_chunks USING gin (fts);


--
-- Name: ai_knowledge_documents_account_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_knowledge_documents_account_id_idx ON public.ai_knowledge_documents USING btree (account_id);


--
-- Name: api_keys_account_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX api_keys_account_id_idx ON public.api_keys USING btree (account_id);


--
-- Name: api_keys_key_hash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX api_keys_key_hash_idx ON public.api_keys USING btree (key_hash);


--
-- Name: idx_account_invitations_account_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_account_invitations_account_pending ON public.account_invitations USING btree (account_id, expires_at) WHERE (accepted_at IS NULL);


--
-- Name: idx_accounts_one_per_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_accounts_one_per_owner ON public.accounts USING btree (owner_user_id);


--
-- Name: idx_ai_usage_log_account_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_usage_log_account_created ON public.ai_usage_log USING btree (account_id, created_at DESC);


--
-- Name: idx_automation_logs_account; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_automation_logs_account ON public.automation_logs USING btree (account_id);


--
-- Name: idx_automation_logs_automation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_automation_logs_automation ON public.automation_logs USING btree (automation_id, created_at DESC);


--
-- Name: idx_automation_logs_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_automation_logs_user ON public.automation_logs USING btree (user_id);


--
-- Name: idx_automation_pending_account; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_automation_pending_account ON public.automation_pending_executions USING btree (account_id);


--
-- Name: idx_automation_pending_awaiting_reply; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_automation_pending_awaiting_reply ON public.automation_pending_executions USING btree (account_id, contact_id) WHERE (status = 'awaiting_reply'::text);


--
-- Name: idx_automation_pending_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_automation_pending_due ON public.automation_pending_executions USING btree (run_at) WHERE (status = 'pending'::text);


--
-- Name: idx_automation_pending_stalled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_automation_pending_stalled ON public.automation_pending_executions USING btree (claimed_at) WHERE (status = 'running'::text);


--
-- Name: idx_automation_steps_automation_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_automation_steps_automation_id ON public.automation_steps USING btree (automation_id, "position");


--
-- Name: idx_automation_steps_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_automation_steps_parent ON public.automation_steps USING btree (parent_step_id) WHERE (parent_step_id IS NOT NULL);


--
-- Name: idx_automations_account; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_automations_account ON public.automations USING btree (account_id);


--
-- Name: idx_automations_account_active_trigger; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_automations_account_active_trigger ON public.automations USING btree (account_id, trigger_type) WHERE (is_active = true);


--
-- Name: idx_automations_active_trigger; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_automations_active_trigger ON public.automations USING btree (trigger_type) WHERE (is_active = true);


--
-- Name: idx_automations_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_automations_user_id ON public.automations USING btree (user_id);


--
-- Name: idx_broadcast_recipients_broadcast; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_broadcast_recipients_broadcast ON public.broadcast_recipients USING btree (broadcast_id);


--
-- Name: idx_broadcast_recipients_broadcast_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_broadcast_recipients_broadcast_status ON public.broadcast_recipients USING btree (broadcast_id, status);


--
-- Name: idx_broadcast_recipients_wamid; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_broadcast_recipients_wamid ON public.broadcast_recipients USING btree (whatsapp_message_id) WHERE (whatsapp_message_id IS NOT NULL);


--
-- Name: idx_broadcasts_account; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_broadcasts_account ON public.broadcasts USING btree (account_id);


--
-- Name: idx_contact_notes_account; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contact_notes_account ON public.contact_notes USING btree (account_id);


--
-- Name: idx_contact_tags_contact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contact_tags_contact ON public.contact_tags USING btree (contact_id);


--
-- Name: idx_contact_tags_tag; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contact_tags_tag ON public.contact_tags USING btree (tag_id);


--
-- Name: idx_contacts_account; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contacts_account ON public.contacts USING btree (account_id);


--
-- Name: idx_contacts_account_phone_normalized; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_contacts_account_phone_normalized ON public.contacts USING btree (account_id, phone_normalized) WHERE (phone_normalized <> ''::text);


--
-- Name: idx_contacts_account_wa_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_contacts_account_wa_user_id ON public.contacts USING btree (account_id, wa_user_id) WHERE (wa_user_id IS NOT NULL);


--
-- Name: idx_contacts_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contacts_phone ON public.contacts USING btree (phone);


--
-- Name: idx_contacts_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contacts_user_id ON public.contacts USING btree (user_id);


--
-- Name: idx_conversations_account; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_account ON public.conversations USING btree (account_id);


--
-- Name: idx_conversations_account_awaiting; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_account_awaiting ON public.conversations USING btree (account_id, last_inbound_at) WHERE ((status <> 'closed'::text) AND (last_inbound_at IS NOT NULL));


--
-- Name: idx_conversations_account_closed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_account_closed ON public.conversations USING btree (account_id, closed_at) WHERE (closed_at IS NOT NULL);


--
-- Name: idx_conversations_account_contact; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_conversations_account_contact ON public.conversations USING btree (account_id, contact_id);


--
-- Name: idx_conversations_account_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_account_created ON public.conversations USING btree (account_id, created_at);


--
-- Name: idx_conversations_contact_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_contact_id ON public.conversations USING btree (contact_id);


--
-- Name: idx_conversations_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_user_id ON public.conversations USING btree (user_id);


--
-- Name: idx_custom_fields_account; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_custom_fields_account ON public.custom_fields USING btree (account_id);


--
-- Name: idx_deals_account; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deals_account ON public.deals USING btree (account_id);


--
-- Name: idx_deals_account_closed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deals_account_closed ON public.deals USING btree (account_id, closed_at) WHERE (closed_at IS NOT NULL);


--
-- Name: idx_deals_assigned_to; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deals_assigned_to ON public.deals USING btree (assigned_to);


--
-- Name: idx_deals_pipeline; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deals_pipeline ON public.deals USING btree (pipeline_id);


--
-- Name: idx_deals_stage; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deals_stage ON public.deals USING btree (stage_id);


--
-- Name: idx_flow_nodes_flow; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_flow_nodes_flow ON public.flow_nodes USING btree (flow_id);


--
-- Name: idx_flow_run_events_run_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_flow_run_events_run_time ON public.flow_run_events USING btree (flow_run_id, created_at DESC);


--
-- Name: idx_flow_run_events_run_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_flow_run_events_run_type ON public.flow_run_events USING btree (flow_run_id, event_type);


--
-- Name: idx_flow_runs_account; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_flow_runs_account ON public.flow_runs USING btree (account_id);


--
-- Name: idx_flow_runs_active_advanced; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_flow_runs_active_advanced ON public.flow_runs USING btree (last_advanced_at) WHERE (status = 'active'::text);


--
-- Name: idx_flow_runs_flow_started; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_flow_runs_flow_started ON public.flow_runs USING btree (flow_id, started_at DESC);


--
-- Name: idx_flows_account; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_flows_account ON public.flows USING btree (account_id);


--
-- Name: idx_flows_account_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_flows_account_active ON public.flows USING btree (account_id) WHERE (status = 'active'::text);


--
-- Name: idx_flows_active_trigger; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_flows_active_trigger ON public.flows USING btree (user_id, trigger_type) WHERE (status = 'active'::text);


--
-- Name: idx_message_reactions_conversation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_message_reactions_conversation ON public.message_reactions USING btree (conversation_id);


--
-- Name: idx_message_reactions_message; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_message_reactions_message ON public.message_reactions USING btree (message_id);


--
-- Name: idx_message_reactions_one_agent_reaction; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_message_reactions_one_agent_reaction ON public.message_reactions USING btree (message_id) WHERE (actor_type = 'agent'::text);


--
-- Name: idx_message_templates_account; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_message_templates_account ON public.message_templates USING btree (account_id);


--
-- Name: idx_message_templates_meta_template_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_message_templates_meta_template_id ON public.message_templates USING btree (meta_template_id) WHERE (meta_template_id IS NOT NULL);


--
-- Name: idx_messages_conversation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_conversation ON public.messages USING btree (conversation_id);


--
-- Name: idx_messages_conversation_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_conversation_created ON public.messages USING btree (conversation_id, created_at);


--
-- Name: idx_messages_conversation_message_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_messages_conversation_message_id ON public.messages USING btree (conversation_id, message_id);


--
-- Name: idx_messages_message_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_message_id ON public.messages USING btree (message_id);


--
-- Name: idx_messages_reply_to; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_reply_to ON public.messages USING btree (reply_to_message_id) WHERE (reply_to_message_id IS NOT NULL);


--
-- Name: idx_notifications_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_user_created ON public.notifications USING btree (user_id, created_at DESC);


--
-- Name: idx_notifications_user_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_user_unread ON public.notifications USING btree (user_id) WHERE (read_at IS NULL);


--
-- Name: idx_one_active_run_per_contact; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_one_active_run_per_contact ON public.flow_runs USING btree (account_id, contact_id) WHERE (status = 'active'::text);


--
-- Name: idx_pending_message_statuses_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pending_message_statuses_created_at ON public.pending_message_statuses USING btree (created_at);


--
-- Name: idx_pipeline_stages_pipeline; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pipeline_stages_pipeline ON public.pipeline_stages USING btree (pipeline_id);


--
-- Name: idx_pipelines_account; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pipelines_account ON public.pipelines USING btree (account_id);


--
-- Name: idx_profiles_account_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profiles_account_role ON public.profiles USING btree (account_id, account_role);


--
-- Name: idx_quick_replies_account; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quick_replies_account ON public.quick_replies USING btree (account_id);


--
-- Name: idx_tags_account; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tags_account ON public.tags USING btree (account_id);


--
-- Name: idx_whatsapp_config_account; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_whatsapp_config_account ON public.whatsapp_config USING btree (account_id);


--
-- Name: idx_whatsapp_config_registered_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_whatsapp_config_registered_at ON public.whatsapp_config USING btree (registered_at) WHERE (registered_at IS NULL);


--
-- Name: lead_activity_one_per_rule_entry; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX lead_activity_one_per_rule_entry ON public.lead_activity USING btree (lead_id, rule_id, stage_history_id) WHERE (rule_id IS NOT NULL);


--
-- Name: lead_activity_open_calls_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX lead_activity_open_calls_idx ON public.lead_activity USING btree (account_id, due_at) WHERE ((kind = 'call_task'::public.lead_activity_kind) AND (done_at IS NULL));


--
-- Name: lead_stage_history_lead_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX lead_stage_history_lead_idx ON public.lead_stage_history USING btree (lead_id, entered_at DESC);


--
-- Name: leads_account_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX leads_account_id_idx ON public.leads USING btree (account_id);


--
-- Name: leads_one_open_per_contact; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX leads_one_open_per_contact ON public.leads USING btree (contact_id) WHERE ((exit IS NULL) AND (admitted_at IS NULL));


--
-- Name: member_presence_account_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX member_presence_account_idx ON public.member_presence USING btree (account_id);


--
-- Name: message_templates_account_name_language_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX message_templates_account_name_language_key ON public.message_templates USING btree (account_id, name, language);


--
-- Name: settings_changes_account_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX settings_changes_account_idx ON public.settings_changes USING btree (account_id, changed_at DESC);


--
-- Name: visits_lead_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX visits_lead_id_idx ON public.visits USING btree (lead_id, created_at DESC);


--
-- Name: webhook_endpoints_account_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX webhook_endpoints_account_id_idx ON public.webhook_endpoints USING btree (account_id);


--
-- Name: admissions_settings admissions_settings_check_in_use; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER admissions_settings_check_in_use BEFORE UPDATE OF kind, account_id ON public.admissions_settings FOR EACH ROW EXECUTE FUNCTION public.check_setting_in_use();


--
-- Name: admissions_settings admissions_settings_rule_action_fixed; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER admissions_settings_rule_action_fixed BEFORE UPDATE OF value ON public.admissions_settings FOR EACH ROW EXECUTE FUNCTION public.check_rule_action_in_use();


--
-- Name: ai_configs ai_configs_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER ai_configs_updated_at BEFORE UPDATE ON public.ai_configs FOR EACH ROW EXECUTE FUNCTION public.update_ai_configs_updated_at();


--
-- Name: ai_knowledge_documents ai_knowledge_documents_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER ai_knowledge_documents_updated_at BEFORE UPDATE ON public.ai_knowledge_documents FOR EACH ROW EXECUTE FUNCTION public.update_ai_knowledge_documents_updated_at();


--
-- Name: admissions_settings audit_admissions_settings; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_admissions_settings AFTER INSERT OR DELETE OR UPDATE ON public.admissions_settings FOR EACH ROW EXECUTE FUNCTION public.audit_admissions_settings();


--
-- Name: broadcast_recipients broadcast_recipients_aggregate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER broadcast_recipients_aggregate AFTER INSERT OR DELETE OR UPDATE ON public.broadcast_recipients FOR EACH ROW EXECUTE FUNCTION public.broadcast_recipient_aggregate_trigger();


--
-- Name: conversations conversations_stamp_closed_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER conversations_stamp_closed_at BEFORE INSERT OR UPDATE OF status ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.stamp_conversation_closed_at();


--
-- Name: deals deals_record_stage_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER deals_record_stage_change AFTER UPDATE OF stage_id ON public.deals FOR EACH ROW WHEN ((new.stage_id IS DISTINCT FROM old.stage_id)) EXECUTE FUNCTION public.record_stage_change();


--
-- Name: deals deals_stamp_closed_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER deals_stamp_closed_at BEFORE INSERT OR UPDATE OF status ON public.deals FOR EACH ROW EXECUTE FUNCTION public.stamp_deal_closed_at();


--
-- Name: deals deals_sync_lead_contact; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER deals_sync_lead_contact AFTER UPDATE OF contact_id, account_id ON public.deals FOR EACH ROW EXECUTE FUNCTION public.sync_lead_contact();


--
-- Name: accounts enforce_account_identity_columns; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER enforce_account_identity_columns BEFORE UPDATE ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.enforce_account_identity_columns();


--
-- Name: conversations enforce_conversation_assignee_membership; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER enforce_conversation_assignee_membership BEFORE INSERT OR UPDATE OF assigned_agent_id, account_id ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.enforce_conversation_assignee_membership();


--
-- Name: profiles enforce_profile_privilege_columns; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER enforce_profile_privilege_columns BEFORE INSERT OR UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.enforce_profile_privilege_columns();


--
-- Name: lead_activity lead_activity_check_refs; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER lead_activity_check_refs BEFORE INSERT OR UPDATE ON public.lead_activity FOR EACH ROW EXECUTE FUNCTION public.check_lead_activity_refs();


--
-- Name: lead_activity lead_activity_rule_made; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER lead_activity_rule_made AFTER INSERT OR UPDATE ON public.lead_activity FOR EACH ROW EXECUTE FUNCTION public.check_rule_made_activity();


--
-- Name: leads leads_check_integrity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER leads_check_integrity BEFORE INSERT OR UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.check_lead_integrity();


--
-- Name: leads leads_record_first_stage; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER leads_record_first_stage AFTER INSERT ON public.leads FOR EACH ROW EXECUTE FUNCTION public.record_first_stage();


--
-- Name: leads leads_sync_deal_status; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER leads_sync_deal_status AFTER INSERT OR UPDATE OF exit, admitted_at ON public.leads FOR EACH ROW EXECUTE FUNCTION public.sync_deal_status();


--
-- Name: messages messages_track_conversation_times; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER messages_track_conversation_times AFTER INSERT OR UPDATE OF status ON public.messages FOR EACH ROW EXECUTE FUNCTION public.track_conversation_message_times();


--
-- Name: conversations on_conversation_assigned; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER on_conversation_assigned AFTER INSERT OR UPDATE OF assigned_agent_id ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.notify_conversation_assigned();


--
-- Name: accounts set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: automations set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.automations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: broadcasts set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.broadcasts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: contacts set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.contacts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: conversations set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: deals set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.deals FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: flows set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.flows FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: message_templates set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.message_templates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: profiles set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: quick_replies set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.quick_replies FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: whatsapp_config set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.whatsapp_config FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: admissions_settings update_admissions_settings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_admissions_settings_updated_at BEFORE UPDATE ON public.admissions_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: lead_activity update_lead_activity_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_lead_activity_updated_at BEFORE UPDATE ON public.lead_activity FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: leads update_leads_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_leads_updated_at BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: visits update_visits_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_visits_updated_at BEFORE UPDATE ON public.visits FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: visits visits_check_refs; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER visits_check_refs BEFORE INSERT OR UPDATE ON public.visits FOR EACH ROW EXECUTE FUNCTION public.check_visit_refs();


--
-- Name: account_invitations account_invitations_accepted_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_invitations
    ADD CONSTRAINT account_invitations_accepted_by_user_id_fkey FOREIGN KEY (accepted_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: account_invitations account_invitations_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_invitations
    ADD CONSTRAINT account_invitations_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: account_invitations account_invitations_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_invitations
    ADD CONSTRAINT account_invitations_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: accounts accounts_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: admissions_settings admissions_settings_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admissions_settings
    ADD CONSTRAINT admissions_settings_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: ai_configs ai_configs_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_configs
    ADD CONSTRAINT ai_configs_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: ai_configs ai_configs_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_configs
    ADD CONSTRAINT ai_configs_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: ai_configs ai_configs_handoff_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_configs
    ADD CONSTRAINT ai_configs_handoff_agent_id_fkey FOREIGN KEY (handoff_agent_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: ai_knowledge_chunks ai_knowledge_chunks_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_knowledge_chunks
    ADD CONSTRAINT ai_knowledge_chunks_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: ai_knowledge_chunks ai_knowledge_chunks_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_knowledge_chunks
    ADD CONSTRAINT ai_knowledge_chunks_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.ai_knowledge_documents(id) ON DELETE CASCADE;


--
-- Name: ai_knowledge_documents ai_knowledge_documents_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_knowledge_documents
    ADD CONSTRAINT ai_knowledge_documents_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: ai_knowledge_documents ai_knowledge_documents_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_knowledge_documents
    ADD CONSTRAINT ai_knowledge_documents_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: ai_usage_log ai_usage_log_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_usage_log
    ADD CONSTRAINT ai_usage_log_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: ai_usage_log ai_usage_log_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_usage_log
    ADD CONSTRAINT ai_usage_log_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE SET NULL;


--
-- Name: api_keys api_keys_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: api_keys api_keys_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: automation_logs automation_logs_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_logs
    ADD CONSTRAINT automation_logs_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: automation_logs automation_logs_automation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_logs
    ADD CONSTRAINT automation_logs_automation_id_fkey FOREIGN KEY (automation_id) REFERENCES public.automations(id) ON DELETE CASCADE;


--
-- Name: automation_logs automation_logs_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_logs
    ADD CONSTRAINT automation_logs_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;


--
-- Name: automation_logs automation_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_logs
    ADD CONSTRAINT automation_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: automation_pending_executions automation_pending_executions_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_pending_executions
    ADD CONSTRAINT automation_pending_executions_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: automation_pending_executions automation_pending_executions_automation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_pending_executions
    ADD CONSTRAINT automation_pending_executions_automation_id_fkey FOREIGN KEY (automation_id) REFERENCES public.automations(id) ON DELETE CASCADE;


--
-- Name: automation_pending_executions automation_pending_executions_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_pending_executions
    ADD CONSTRAINT automation_pending_executions_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;


--
-- Name: automation_pending_executions automation_pending_executions_log_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_pending_executions
    ADD CONSTRAINT automation_pending_executions_log_id_fkey FOREIGN KEY (log_id) REFERENCES public.automation_logs(id) ON DELETE CASCADE;


--
-- Name: automation_pending_executions automation_pending_executions_parent_step_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_pending_executions
    ADD CONSTRAINT automation_pending_executions_parent_step_id_fkey FOREIGN KEY (parent_step_id) REFERENCES public.automation_steps(id) ON DELETE SET NULL;


--
-- Name: automation_pending_executions automation_pending_executions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_pending_executions
    ADD CONSTRAINT automation_pending_executions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: automation_steps automation_steps_automation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_steps
    ADD CONSTRAINT automation_steps_automation_id_fkey FOREIGN KEY (automation_id) REFERENCES public.automations(id) ON DELETE CASCADE;


--
-- Name: automation_steps automation_steps_parent_step_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_steps
    ADD CONSTRAINT automation_steps_parent_step_id_fkey FOREIGN KEY (parent_step_id) REFERENCES public.automation_steps(id) ON DELETE CASCADE;


--
-- Name: automations automations_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automations
    ADD CONSTRAINT automations_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: automations automations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automations
    ADD CONSTRAINT automations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: broadcast_recipients broadcast_recipients_broadcast_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.broadcast_recipients
    ADD CONSTRAINT broadcast_recipients_broadcast_id_fkey FOREIGN KEY (broadcast_id) REFERENCES public.broadcasts(id) ON DELETE CASCADE;


--
-- Name: broadcast_recipients broadcast_recipients_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.broadcast_recipients
    ADD CONSTRAINT broadcast_recipients_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;


--
-- Name: broadcasts broadcasts_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.broadcasts
    ADD CONSTRAINT broadcasts_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: broadcasts broadcasts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.broadcasts
    ADD CONSTRAINT broadcasts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: contact_custom_values contact_custom_values_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_custom_values
    ADD CONSTRAINT contact_custom_values_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE;


--
-- Name: contact_custom_values contact_custom_values_custom_field_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_custom_values
    ADD CONSTRAINT contact_custom_values_custom_field_id_fkey FOREIGN KEY (custom_field_id) REFERENCES public.custom_fields(id) ON DELETE CASCADE;


--
-- Name: contact_notes contact_notes_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_notes
    ADD CONSTRAINT contact_notes_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: contact_notes contact_notes_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_notes
    ADD CONSTRAINT contact_notes_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE;


--
-- Name: contact_notes contact_notes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_notes
    ADD CONSTRAINT contact_notes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: contact_tags contact_tags_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_tags
    ADD CONSTRAINT contact_tags_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE;


--
-- Name: contact_tags contact_tags_tag_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_tags
    ADD CONSTRAINT contact_tags_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.tags(id) ON DELETE CASCADE;


--
-- Name: contacts contacts_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: contacts contacts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: conversations conversations_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: conversations conversations_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE;


--
-- Name: conversations conversations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: custom_fields custom_fields_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_fields
    ADD CONSTRAINT custom_fields_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: custom_fields custom_fields_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_fields
    ADD CONSTRAINT custom_fields_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: deals deals_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deals
    ADD CONSTRAINT deals_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: deals deals_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deals
    ADD CONSTRAINT deals_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: deals deals_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deals
    ADD CONSTRAINT deals_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;


--
-- Name: deals deals_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deals
    ADD CONSTRAINT deals_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id);


--
-- Name: deals deals_pipeline_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deals
    ADD CONSTRAINT deals_pipeline_id_fkey FOREIGN KEY (pipeline_id) REFERENCES public.pipelines(id) ON DELETE CASCADE;


--
-- Name: deals deals_stage_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deals
    ADD CONSTRAINT deals_stage_id_fkey FOREIGN KEY (stage_id) REFERENCES public.pipeline_stages(id);


--
-- Name: deals deals_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deals
    ADD CONSTRAINT deals_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: flow_nodes flow_nodes_flow_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flow_nodes
    ADD CONSTRAINT flow_nodes_flow_id_fkey FOREIGN KEY (flow_id) REFERENCES public.flows(id) ON DELETE CASCADE;


--
-- Name: flow_run_events flow_run_events_flow_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flow_run_events
    ADD CONSTRAINT flow_run_events_flow_run_id_fkey FOREIGN KEY (flow_run_id) REFERENCES public.flow_runs(id) ON DELETE CASCADE;


--
-- Name: flow_runs flow_runs_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flow_runs
    ADD CONSTRAINT flow_runs_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: flow_runs flow_runs_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flow_runs
    ADD CONSTRAINT flow_runs_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;


--
-- Name: flow_runs flow_runs_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flow_runs
    ADD CONSTRAINT flow_runs_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE SET NULL;


--
-- Name: flow_runs flow_runs_flow_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flow_runs
    ADD CONSTRAINT flow_runs_flow_id_fkey FOREIGN KEY (flow_id) REFERENCES public.flows(id) ON DELETE CASCADE;


--
-- Name: flow_runs flow_runs_last_prompt_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flow_runs
    ADD CONSTRAINT flow_runs_last_prompt_message_id_fkey FOREIGN KEY (last_prompt_message_id) REFERENCES public.messages(id) ON DELETE SET NULL;


--
-- Name: flow_runs flow_runs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flow_runs
    ADD CONSTRAINT flow_runs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: flows flows_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flows
    ADD CONSTRAINT flows_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: flows flows_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flows
    ADD CONSTRAINT flows_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: lead_activity lead_activity_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_activity
    ADD CONSTRAINT lead_activity_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: lead_activity lead_activity_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_activity
    ADD CONSTRAINT lead_activity_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: lead_activity lead_activity_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_activity
    ADD CONSTRAINT lead_activity_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: lead_activity lead_activity_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_activity
    ADD CONSTRAINT lead_activity_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;


--
-- Name: lead_activity lead_activity_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_activity
    ADD CONSTRAINT lead_activity_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.messages(id) ON DELETE SET NULL;


--
-- Name: lead_activity lead_activity_rule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_activity
    ADD CONSTRAINT lead_activity_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES public.admissions_settings(id);


--
-- Name: lead_activity lead_activity_stage_history_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_activity
    ADD CONSTRAINT lead_activity_stage_history_id_fkey FOREIGN KEY (stage_history_id) REFERENCES public.lead_stage_history(id) ON DELETE CASCADE;


--
-- Name: lead_stage_history lead_stage_history_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_stage_history
    ADD CONSTRAINT lead_stage_history_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: lead_stage_history lead_stage_history_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_stage_history
    ADD CONSTRAINT lead_stage_history_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;


--
-- Name: lead_stage_history lead_stage_history_moved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_stage_history
    ADD CONSTRAINT lead_stage_history_moved_by_fkey FOREIGN KEY (moved_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: lead_stage_history lead_stage_history_stage_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_stage_history
    ADD CONSTRAINT lead_stage_history_stage_id_fkey FOREIGN KEY (stage_id) REFERENCES public.pipeline_stages(id) ON DELETE RESTRICT;


--
-- Name: leads leads_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: leads leads_campus_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_campus_id_fkey FOREIGN KEY (campus_id) REFERENCES public.admissions_settings(id) ON DELETE RESTRICT;


--
-- Name: leads leads_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE RESTRICT;


--
-- Name: leads leads_deal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_deal_id_fkey FOREIGN KEY (deal_id) REFERENCES public.deals(id) ON DELETE CASCADE;


--
-- Name: leads leads_lost_reason_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_lost_reason_id_fkey FOREIGN KEY (lost_reason_id) REFERENCES public.admissions_settings(id) ON DELETE RESTRICT;


--
-- Name: leads leads_source_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.admissions_settings(id) ON DELETE RESTRICT;


--
-- Name: member_presence member_presence_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_presence
    ADD CONSTRAINT member_presence_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: member_presence member_presence_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_presence
    ADD CONSTRAINT member_presence_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: message_reactions message_reactions_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_reactions
    ADD CONSTRAINT message_reactions_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: message_reactions message_reactions_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_reactions
    ADD CONSTRAINT message_reactions_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.messages(id) ON DELETE CASCADE;


--
-- Name: message_templates message_templates_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_templates
    ADD CONSTRAINT message_templates_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: message_templates message_templates_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_templates
    ADD CONSTRAINT message_templates_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: messages messages_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: messages messages_reply_to_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_reply_to_message_id_fkey FOREIGN KEY (reply_to_message_id) REFERENCES public.messages(id) ON DELETE SET NULL;


--
-- Name: notifications notifications_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: notifications notifications_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;


--
-- Name: notifications notifications_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: pending_message_statuses pending_message_statuses_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_message_statuses
    ADD CONSTRAINT pending_message_statuses_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: pipeline_stages pipeline_stages_pipeline_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipeline_stages
    ADD CONSTRAINT pipeline_stages_pipeline_id_fkey FOREIGN KEY (pipeline_id) REFERENCES public.pipelines(id) ON DELETE CASCADE;


--
-- Name: pipelines pipelines_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipelines
    ADD CONSTRAINT pipelines_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: pipelines pipelines_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipelines
    ADD CONSTRAINT pipelines_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: quick_replies quick_replies_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quick_replies
    ADD CONSTRAINT quick_replies_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: quick_replies quick_replies_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quick_replies
    ADD CONSTRAINT quick_replies_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: settings_changes settings_changes_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings_changes
    ADD CONSTRAINT settings_changes_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: settings_changes settings_changes_changed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings_changes
    ADD CONSTRAINT settings_changes_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: tags tags_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: tags tags_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: visits visits_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visits
    ADD CONSTRAINT visits_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: visits visits_campus_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visits
    ADD CONSTRAINT visits_campus_id_fkey FOREIGN KEY (campus_id) REFERENCES public.admissions_settings(id) ON DELETE RESTRICT;


--
-- Name: visits visits_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visits
    ADD CONSTRAINT visits_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;


--
-- Name: webhook_endpoints webhook_endpoints_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_endpoints
    ADD CONSTRAINT webhook_endpoints_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: webhook_endpoints webhook_endpoints_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_endpoints
    ADD CONSTRAINT webhook_endpoints_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: whatsapp_config whatsapp_config_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_config
    ADD CONSTRAINT whatsapp_config_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: whatsapp_config whatsapp_config_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_config
    ADD CONSTRAINT whatsapp_config_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: account_invitations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.account_invitations ENABLE ROW LEVEL SECURITY;

--
-- Name: account_invitations account_invitations_modify; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY account_invitations_modify ON public.account_invitations USING (public.is_account_member(account_id, 'admin'::public.account_role_enum)) WITH CHECK (public.is_account_member(account_id, 'admin'::public.account_role_enum));


--
-- Name: account_invitations account_invitations_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY account_invitations_select ON public.account_invitations FOR SELECT USING (public.is_account_member(account_id, 'admin'::public.account_role_enum));


--
-- Name: accounts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: accounts accounts_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY accounts_select ON public.accounts FOR SELECT USING (public.is_account_member(id));


--
-- Name: accounts accounts_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY accounts_update ON public.accounts FOR UPDATE USING (public.is_account_member(id, 'admin'::public.account_role_enum)) WITH CHECK (public.is_account_member(id, 'admin'::public.account_role_enum));


--
-- Name: admissions_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admissions_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: admissions_settings admissions_settings_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admissions_settings_delete ON public.admissions_settings FOR DELETE TO authenticated USING (public.is_account_member(account_id, 'admin'::public.account_role_enum));


--
-- Name: admissions_settings admissions_settings_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admissions_settings_insert ON public.admissions_settings FOR INSERT TO authenticated WITH CHECK (public.is_account_member(account_id, 'admin'::public.account_role_enum));


--
-- Name: admissions_settings admissions_settings_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admissions_settings_select ON public.admissions_settings FOR SELECT TO authenticated USING (public.is_account_member(account_id));


--
-- Name: admissions_settings admissions_settings_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admissions_settings_update ON public.admissions_settings FOR UPDATE TO authenticated USING (public.is_account_member(account_id, 'admin'::public.account_role_enum)) WITH CHECK (public.is_account_member(account_id, 'admin'::public.account_role_enum));


--
-- Name: ai_configs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_configs ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_configs ai_configs_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ai_configs_delete ON public.ai_configs FOR DELETE USING (public.is_account_member(account_id, 'admin'::public.account_role_enum));


--
-- Name: ai_configs ai_configs_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ai_configs_insert ON public.ai_configs FOR INSERT WITH CHECK (public.is_account_member(account_id, 'admin'::public.account_role_enum));


--
-- Name: ai_configs ai_configs_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ai_configs_select ON public.ai_configs FOR SELECT USING (public.is_account_member(account_id));


--
-- Name: ai_configs ai_configs_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ai_configs_update ON public.ai_configs FOR UPDATE USING (public.is_account_member(account_id, 'admin'::public.account_role_enum));


--
-- Name: ai_knowledge_chunks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_knowledge_chunks ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_knowledge_chunks ai_knowledge_chunks_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ai_knowledge_chunks_delete ON public.ai_knowledge_chunks FOR DELETE USING (public.is_account_member(account_id, 'admin'::public.account_role_enum));


--
-- Name: ai_knowledge_chunks ai_knowledge_chunks_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ai_knowledge_chunks_insert ON public.ai_knowledge_chunks FOR INSERT WITH CHECK (public.is_account_member(account_id, 'admin'::public.account_role_enum));


--
-- Name: ai_knowledge_chunks ai_knowledge_chunks_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ai_knowledge_chunks_select ON public.ai_knowledge_chunks FOR SELECT USING (public.is_account_member(account_id));


--
-- Name: ai_knowledge_chunks ai_knowledge_chunks_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ai_knowledge_chunks_update ON public.ai_knowledge_chunks FOR UPDATE USING (public.is_account_member(account_id, 'admin'::public.account_role_enum));


--
-- Name: ai_knowledge_documents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_knowledge_documents ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_knowledge_documents ai_knowledge_documents_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ai_knowledge_documents_delete ON public.ai_knowledge_documents FOR DELETE USING (public.is_account_member(account_id, 'admin'::public.account_role_enum));


--
-- Name: ai_knowledge_documents ai_knowledge_documents_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ai_knowledge_documents_insert ON public.ai_knowledge_documents FOR INSERT WITH CHECK (public.is_account_member(account_id, 'admin'::public.account_role_enum));


--
-- Name: ai_knowledge_documents ai_knowledge_documents_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ai_knowledge_documents_select ON public.ai_knowledge_documents FOR SELECT USING (public.is_account_member(account_id));


--
-- Name: ai_knowledge_documents ai_knowledge_documents_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ai_knowledge_documents_update ON public.ai_knowledge_documents FOR UPDATE USING (public.is_account_member(account_id, 'admin'::public.account_role_enum));


--
-- Name: ai_usage_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_usage_log ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_usage_log ai_usage_log_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ai_usage_log_select ON public.ai_usage_log FOR SELECT USING (public.is_account_member(account_id, 'admin'::public.account_role_enum));


--
-- Name: api_keys; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

--
-- Name: api_keys api_keys_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY api_keys_delete ON public.api_keys FOR DELETE USING (public.is_account_member(account_id, 'admin'::public.account_role_enum));


--
-- Name: api_keys api_keys_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY api_keys_insert ON public.api_keys FOR INSERT WITH CHECK (public.is_account_member(account_id, 'admin'::public.account_role_enum));


--
-- Name: api_keys api_keys_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY api_keys_select ON public.api_keys FOR SELECT USING (public.is_account_member(account_id));


--
-- Name: api_keys api_keys_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY api_keys_update ON public.api_keys FOR UPDATE USING (public.is_account_member(account_id, 'admin'::public.account_role_enum));


--
-- Name: automation_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.automation_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: automation_logs automation_logs_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY automation_logs_select ON public.automation_logs FOR SELECT USING (public.is_account_member(account_id));


--
-- Name: automation_pending_executions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.automation_pending_executions ENABLE ROW LEVEL SECURITY;

--
-- Name: automation_steps; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.automation_steps ENABLE ROW LEVEL SECURITY;

--
-- Name: automation_steps automation_steps_modify; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY automation_steps_modify ON public.automation_steps USING ((EXISTS ( SELECT 1
   FROM public.automations a
  WHERE ((a.id = automation_steps.automation_id) AND public.is_account_member(a.account_id, 'agent'::public.account_role_enum))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.automations a
  WHERE ((a.id = automation_steps.automation_id) AND public.is_account_member(a.account_id, 'agent'::public.account_role_enum)))));


--
-- Name: automation_steps automation_steps_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY automation_steps_select ON public.automation_steps FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.automations a
  WHERE ((a.id = automation_steps.automation_id) AND public.is_account_member(a.account_id)))));


--
-- Name: automations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.automations ENABLE ROW LEVEL SECURITY;

--
-- Name: automations automations_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY automations_delete ON public.automations FOR DELETE USING (public.is_account_member(account_id, 'agent'::public.account_role_enum));


--
-- Name: automations automations_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY automations_insert ON public.automations FOR INSERT WITH CHECK (public.is_account_member(account_id, 'agent'::public.account_role_enum));


--
-- Name: automations automations_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY automations_select ON public.automations FOR SELECT USING (public.is_account_member(account_id));


--
-- Name: automations automations_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY automations_update ON public.automations FOR UPDATE USING (public.is_account_member(account_id, 'agent'::public.account_role_enum));


--
-- Name: broadcast_recipients; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.broadcast_recipients ENABLE ROW LEVEL SECURITY;

--
-- Name: broadcast_recipients broadcast_recipients_modify; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY broadcast_recipients_modify ON public.broadcast_recipients USING ((EXISTS ( SELECT 1
   FROM public.broadcasts b
  WHERE ((b.id = broadcast_recipients.broadcast_id) AND public.is_account_member(b.account_id, 'agent'::public.account_role_enum))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.broadcasts b
  WHERE ((b.id = broadcast_recipients.broadcast_id) AND public.is_account_member(b.account_id, 'agent'::public.account_role_enum)))));


--
-- Name: broadcast_recipients broadcast_recipients_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY broadcast_recipients_select ON public.broadcast_recipients FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.broadcasts b
  WHERE ((b.id = broadcast_recipients.broadcast_id) AND public.is_account_member(b.account_id)))));


--
-- Name: broadcasts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.broadcasts ENABLE ROW LEVEL SECURITY;

--
-- Name: broadcasts broadcasts_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY broadcasts_delete ON public.broadcasts FOR DELETE USING (public.is_account_member(account_id, 'agent'::public.account_role_enum));


--
-- Name: broadcasts broadcasts_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY broadcasts_insert ON public.broadcasts FOR INSERT WITH CHECK (public.is_account_member(account_id, 'agent'::public.account_role_enum));


--
-- Name: broadcasts broadcasts_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY broadcasts_select ON public.broadcasts FOR SELECT USING (public.is_account_member(account_id));


--
-- Name: broadcasts broadcasts_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY broadcasts_update ON public.broadcasts FOR UPDATE USING (public.is_account_member(account_id, 'agent'::public.account_role_enum));


--
-- Name: contact_custom_values; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contact_custom_values ENABLE ROW LEVEL SECURITY;

--
-- Name: contact_custom_values contact_custom_values_modify; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY contact_custom_values_modify ON public.contact_custom_values USING ((EXISTS ( SELECT 1
   FROM public.contacts c
  WHERE ((c.id = contact_custom_values.contact_id) AND public.is_account_member(c.account_id, 'agent'::public.account_role_enum))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.contacts c
  WHERE ((c.id = contact_custom_values.contact_id) AND public.is_account_member(c.account_id, 'agent'::public.account_role_enum)))));


--
-- Name: contact_custom_values contact_custom_values_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY contact_custom_values_select ON public.contact_custom_values FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.contacts c
  WHERE ((c.id = contact_custom_values.contact_id) AND public.is_account_member(c.account_id)))));


--
-- Name: contact_notes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contact_notes ENABLE ROW LEVEL SECURITY;

--
-- Name: contact_notes contact_notes_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY contact_notes_delete ON public.contact_notes FOR DELETE USING (public.is_account_member(account_id, 'agent'::public.account_role_enum));


--
-- Name: contact_notes contact_notes_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY contact_notes_insert ON public.contact_notes FOR INSERT WITH CHECK (public.is_account_member(account_id, 'agent'::public.account_role_enum));


--
-- Name: contact_notes contact_notes_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY contact_notes_select ON public.contact_notes FOR SELECT USING (public.is_account_member(account_id));


--
-- Name: contact_notes contact_notes_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY contact_notes_update ON public.contact_notes FOR UPDATE USING (public.is_account_member(account_id, 'agent'::public.account_role_enum));


--
-- Name: contact_tags; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contact_tags ENABLE ROW LEVEL SECURITY;

--
-- Name: contact_tags contact_tags_modify; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY contact_tags_modify ON public.contact_tags USING ((EXISTS ( SELECT 1
   FROM public.contacts c
  WHERE ((c.id = contact_tags.contact_id) AND public.is_account_member(c.account_id, 'agent'::public.account_role_enum))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.contacts c
  WHERE ((c.id = contact_tags.contact_id) AND public.is_account_member(c.account_id, 'agent'::public.account_role_enum)))));


--
-- Name: contact_tags contact_tags_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY contact_tags_select ON public.contact_tags FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.contacts c
  WHERE ((c.id = contact_tags.contact_id) AND public.is_account_member(c.account_id)))));


--
-- Name: contacts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

--
-- Name: contacts contacts_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY contacts_delete ON public.contacts FOR DELETE USING (public.is_account_member(account_id, 'agent'::public.account_role_enum));


--
-- Name: contacts contacts_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY contacts_insert ON public.contacts FOR INSERT WITH CHECK (public.is_account_member(account_id, 'agent'::public.account_role_enum));


--
-- Name: contacts contacts_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY contacts_select ON public.contacts FOR SELECT USING (public.is_account_member(account_id));


--
-- Name: contacts contacts_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY contacts_update ON public.contacts FOR UPDATE USING (public.is_account_member(account_id, 'agent'::public.account_role_enum));


--
-- Name: conversations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

--
-- Name: conversations conversations_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY conversations_delete ON public.conversations FOR DELETE USING (public.is_account_member(account_id, 'agent'::public.account_role_enum));


--
-- Name: conversations conversations_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY conversations_insert ON public.conversations FOR INSERT WITH CHECK (public.is_account_member(account_id, 'agent'::public.account_role_enum));


--
-- Name: conversations conversations_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY conversations_select ON public.conversations FOR SELECT USING (public.is_account_member(account_id));


--
-- Name: conversations conversations_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY conversations_update ON public.conversations FOR UPDATE USING (public.is_account_member(account_id, 'agent'::public.account_role_enum));


--
-- Name: custom_fields; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.custom_fields ENABLE ROW LEVEL SECURITY;

--
-- Name: custom_fields custom_fields_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY custom_fields_delete ON public.custom_fields FOR DELETE USING (public.is_account_member(account_id, 'admin'::public.account_role_enum));


--
-- Name: custom_fields custom_fields_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY custom_fields_insert ON public.custom_fields FOR INSERT WITH CHECK (public.is_account_member(account_id, 'admin'::public.account_role_enum));


--
-- Name: custom_fields custom_fields_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY custom_fields_select ON public.custom_fields FOR SELECT USING (public.is_account_member(account_id));


--
-- Name: custom_fields custom_fields_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY custom_fields_update ON public.custom_fields FOR UPDATE USING (public.is_account_member(account_id, 'admin'::public.account_role_enum));


--
-- Name: deals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.deals ENABLE ROW LEVEL SECURITY;

--
-- Name: deals deals_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY deals_delete ON public.deals FOR DELETE USING (public.is_account_member(account_id, 'agent'::public.account_role_enum));


--
-- Name: deals deals_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY deals_insert ON public.deals FOR INSERT WITH CHECK (public.is_account_member(account_id, 'agent'::public.account_role_enum));


--
-- Name: deals deals_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY deals_select ON public.deals FOR SELECT USING (public.is_account_member(account_id));


--
-- Name: deals deals_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY deals_update ON public.deals FOR UPDATE USING (public.is_account_member(account_id, 'agent'::public.account_role_enum));


--
-- Name: flow_nodes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.flow_nodes ENABLE ROW LEVEL SECURITY;

--
-- Name: flow_nodes flow_nodes_modify; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY flow_nodes_modify ON public.flow_nodes USING ((EXISTS ( SELECT 1
   FROM public.flows f
  WHERE ((f.id = flow_nodes.flow_id) AND public.is_account_member(f.account_id, 'agent'::public.account_role_enum))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.flows f
  WHERE ((f.id = flow_nodes.flow_id) AND public.is_account_member(f.account_id, 'agent'::public.account_role_enum)))));


--
-- Name: flow_nodes flow_nodes_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY flow_nodes_select ON public.flow_nodes FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.flows f
  WHERE ((f.id = flow_nodes.flow_id) AND public.is_account_member(f.account_id)))));


--
-- Name: flow_run_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.flow_run_events ENABLE ROW LEVEL SECURITY;

--
-- Name: flow_run_events flow_run_events_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY flow_run_events_select ON public.flow_run_events FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.flow_runs r
  WHERE ((r.id = flow_run_events.flow_run_id) AND public.is_account_member(r.account_id)))));


--
-- Name: flow_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.flow_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: flow_runs flow_runs_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY flow_runs_select ON public.flow_runs FOR SELECT USING (public.is_account_member(account_id));


--
-- Name: flows; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.flows ENABLE ROW LEVEL SECURITY;

--
-- Name: flows flows_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY flows_delete ON public.flows FOR DELETE USING (public.is_account_member(account_id, 'agent'::public.account_role_enum));


--
-- Name: flows flows_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY flows_insert ON public.flows FOR INSERT WITH CHECK (public.is_account_member(account_id, 'agent'::public.account_role_enum));


--
-- Name: flows flows_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY flows_select ON public.flows FOR SELECT USING (public.is_account_member(account_id));


--
-- Name: flows flows_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY flows_update ON public.flows FOR UPDATE USING (public.is_account_member(account_id, 'agent'::public.account_role_enum));


--
-- Name: lead_activity; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.lead_activity ENABLE ROW LEVEL SECURITY;

--
-- Name: lead_activity lead_activity_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY lead_activity_delete ON public.lead_activity FOR DELETE TO authenticated USING ((public.is_account_member(account_id, 'admin'::public.account_role_enum) AND (kind = 'call_task'::public.lead_activity_kind)));


--
-- Name: lead_activity lead_activity_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY lead_activity_insert ON public.lead_activity FOR INSERT TO authenticated WITH CHECK ((public.is_account_member(account_id, 'agent'::public.account_role_enum) AND (kind = 'call_task'::public.lead_activity_kind) AND (rule_id IS NULL)));


--
-- Name: lead_activity lead_activity_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY lead_activity_select ON public.lead_activity FOR SELECT TO authenticated USING (public.is_account_member(account_id));


--
-- Name: lead_activity lead_activity_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY lead_activity_update ON public.lead_activity FOR UPDATE TO authenticated USING ((public.is_account_member(account_id, 'agent'::public.account_role_enum) AND (kind = 'call_task'::public.lead_activity_kind))) WITH CHECK ((public.is_account_member(account_id, 'agent'::public.account_role_enum) AND (kind = 'call_task'::public.lead_activity_kind)));


--
-- Name: lead_stage_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.lead_stage_history ENABLE ROW LEVEL SECURITY;

--
-- Name: lead_stage_history lead_stage_history_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY lead_stage_history_select ON public.lead_stage_history FOR SELECT TO authenticated USING (public.is_account_member(account_id));


--
-- Name: leads; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

--
-- Name: leads leads_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY leads_delete ON public.leads FOR DELETE TO authenticated USING (public.is_account_member(account_id, 'admin'::public.account_role_enum));


--
-- Name: leads leads_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY leads_insert ON public.leads FOR INSERT TO authenticated WITH CHECK (public.is_account_member(account_id, 'agent'::public.account_role_enum));


--
-- Name: leads leads_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY leads_select ON public.leads FOR SELECT TO authenticated USING (public.is_account_member(account_id));


--
-- Name: leads leads_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY leads_update ON public.leads FOR UPDATE TO authenticated USING (public.is_account_member(account_id, 'agent'::public.account_role_enum)) WITH CHECK (public.is_account_member(account_id, 'agent'::public.account_role_enum));


--
-- Name: member_presence; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.member_presence ENABLE ROW LEVEL SECURITY;

--
-- Name: member_presence member_presence_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY member_presence_select ON public.member_presence FOR SELECT USING (public.is_account_member(account_id));


--
-- Name: message_reactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.message_reactions ENABLE ROW LEVEL SECURITY;

--
-- Name: message_reactions message_reactions_modify; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY message_reactions_modify ON public.message_reactions USING ((EXISTS ( SELECT 1
   FROM (public.messages m
     JOIN public.conversations c ON ((c.id = m.conversation_id)))
  WHERE ((m.id = message_reactions.message_id) AND public.is_account_member(c.account_id, 'agent'::public.account_role_enum))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.messages m
     JOIN public.conversations c ON ((c.id = m.conversation_id)))
  WHERE ((m.id = message_reactions.message_id) AND public.is_account_member(c.account_id, 'agent'::public.account_role_enum)))));


--
-- Name: message_reactions message_reactions_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY message_reactions_select ON public.message_reactions FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (public.messages m
     JOIN public.conversations c ON ((c.id = m.conversation_id)))
  WHERE ((m.id = message_reactions.message_id) AND public.is_account_member(c.account_id)))));


--
-- Name: message_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.message_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: message_templates message_templates_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY message_templates_delete ON public.message_templates FOR DELETE USING (public.is_account_member(account_id, 'admin'::public.account_role_enum));


--
-- Name: message_templates message_templates_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY message_templates_insert ON public.message_templates FOR INSERT WITH CHECK (public.is_account_member(account_id, 'admin'::public.account_role_enum));


--
-- Name: message_templates message_templates_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY message_templates_select ON public.message_templates FOR SELECT USING (public.is_account_member(account_id));


--
-- Name: message_templates message_templates_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY message_templates_update ON public.message_templates FOR UPDATE USING (public.is_account_member(account_id, 'admin'::public.account_role_enum));


--
-- Name: messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

--
-- Name: messages messages_modify; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY messages_modify ON public.messages USING ((EXISTS ( SELECT 1
   FROM public.conversations c
  WHERE ((c.id = messages.conversation_id) AND public.is_account_member(c.account_id, 'agent'::public.account_role_enum))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.conversations c
  WHERE ((c.id = messages.conversation_id) AND public.is_account_member(c.account_id, 'agent'::public.account_role_enum)))));


--
-- Name: messages messages_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY messages_select ON public.messages FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.conversations c
  WHERE ((c.id = messages.conversation_id) AND public.is_account_member(c.account_id)))));


--
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: notifications notifications_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notifications_select ON public.notifications FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: notifications notifications_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notifications_update ON public.notifications FOR UPDATE USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: pending_message_statuses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pending_message_statuses ENABLE ROW LEVEL SECURITY;

--
-- Name: pipeline_stages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pipeline_stages ENABLE ROW LEVEL SECURITY;

--
-- Name: pipeline_stages pipeline_stages_modify; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pipeline_stages_modify ON public.pipeline_stages USING ((EXISTS ( SELECT 1
   FROM public.pipelines p
  WHERE ((p.id = pipeline_stages.pipeline_id) AND public.is_account_member(p.account_id, 'admin'::public.account_role_enum))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.pipelines p
  WHERE ((p.id = pipeline_stages.pipeline_id) AND public.is_account_member(p.account_id, 'admin'::public.account_role_enum)))));


--
-- Name: pipeline_stages pipeline_stages_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pipeline_stages_select ON public.pipeline_stages FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.pipelines p
  WHERE ((p.id = pipeline_stages.pipeline_id) AND public.is_account_member(p.account_id)))));


--
-- Name: pipelines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pipelines ENABLE ROW LEVEL SECURITY;

--
-- Name: pipelines pipelines_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pipelines_delete ON public.pipelines FOR DELETE USING (public.is_account_member(account_id, 'admin'::public.account_role_enum));


--
-- Name: pipelines pipelines_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pipelines_insert ON public.pipelines FOR INSERT WITH CHECK (public.is_account_member(account_id, 'admin'::public.account_role_enum));


--
-- Name: pipelines pipelines_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pipelines_select ON public.pipelines FOR SELECT USING (public.is_account_member(account_id));


--
-- Name: pipelines pipelines_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pipelines_update ON public.pipelines FOR UPDATE USING (public.is_account_member(account_id, 'admin'::public.account_role_enum));


--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles profiles_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_select ON public.profiles FOR SELECT USING (((auth.uid() = user_id) OR public.is_account_member(account_id)));


--
-- Name: profiles profiles_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_update ON public.profiles FOR UPDATE USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: quick_replies; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.quick_replies ENABLE ROW LEVEL SECURITY;

--
-- Name: quick_replies quick_replies_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY quick_replies_delete ON public.quick_replies FOR DELETE USING (public.is_account_member(account_id, 'agent'::public.account_role_enum));


--
-- Name: quick_replies quick_replies_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY quick_replies_insert ON public.quick_replies FOR INSERT WITH CHECK (public.is_account_member(account_id, 'agent'::public.account_role_enum));


--
-- Name: quick_replies quick_replies_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY quick_replies_select ON public.quick_replies FOR SELECT USING (public.is_account_member(account_id));


--
-- Name: quick_replies quick_replies_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY quick_replies_update ON public.quick_replies FOR UPDATE USING (public.is_account_member(account_id, 'agent'::public.account_role_enum));


--
-- Name: settings_changes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.settings_changes ENABLE ROW LEVEL SECURITY;

--
-- Name: settings_changes settings_changes_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY settings_changes_select ON public.settings_changes FOR SELECT TO authenticated USING (public.is_account_member(account_id));


--
-- Name: tags; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;

--
-- Name: tags tags_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tags_delete ON public.tags FOR DELETE USING (public.is_account_member(account_id, 'admin'::public.account_role_enum));


--
-- Name: tags tags_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tags_insert ON public.tags FOR INSERT WITH CHECK (public.is_account_member(account_id, 'admin'::public.account_role_enum));


--
-- Name: tags tags_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tags_select ON public.tags FOR SELECT USING (public.is_account_member(account_id));


--
-- Name: tags tags_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tags_update ON public.tags FOR UPDATE USING (public.is_account_member(account_id, 'admin'::public.account_role_enum));


--
-- Name: visits; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.visits ENABLE ROW LEVEL SECURITY;

--
-- Name: visits visits_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY visits_delete ON public.visits FOR DELETE TO authenticated USING (public.is_account_member(account_id, 'admin'::public.account_role_enum));


--
-- Name: visits visits_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY visits_insert ON public.visits FOR INSERT TO authenticated WITH CHECK (public.is_account_member(account_id, 'agent'::public.account_role_enum));


--
-- Name: visits visits_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY visits_select ON public.visits FOR SELECT TO authenticated USING (public.is_account_member(account_id));


--
-- Name: visits visits_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY visits_update ON public.visits FOR UPDATE TO authenticated USING (public.is_account_member(account_id, 'agent'::public.account_role_enum)) WITH CHECK (public.is_account_member(account_id, 'agent'::public.account_role_enum));


--
-- Name: webhook_endpoints; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.webhook_endpoints ENABLE ROW LEVEL SECURITY;

--
-- Name: webhook_endpoints webhook_endpoints_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY webhook_endpoints_delete ON public.webhook_endpoints FOR DELETE USING (public.is_account_member(account_id, 'admin'::public.account_role_enum));


--
-- Name: webhook_endpoints webhook_endpoints_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY webhook_endpoints_insert ON public.webhook_endpoints FOR INSERT WITH CHECK (public.is_account_member(account_id, 'admin'::public.account_role_enum));


--
-- Name: webhook_endpoints webhook_endpoints_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY webhook_endpoints_select ON public.webhook_endpoints FOR SELECT USING (public.is_account_member(account_id));


--
-- Name: webhook_endpoints webhook_endpoints_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY webhook_endpoints_update ON public.webhook_endpoints FOR UPDATE USING (public.is_account_member(account_id, 'admin'::public.account_role_enum));


--
-- Name: whatsapp_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.whatsapp_config ENABLE ROW LEVEL SECURITY;

--
-- Name: whatsapp_config whatsapp_config_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY whatsapp_config_delete ON public.whatsapp_config FOR DELETE USING (public.is_account_member(account_id, 'admin'::public.account_role_enum));


--
-- Name: whatsapp_config whatsapp_config_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY whatsapp_config_insert ON public.whatsapp_config FOR INSERT WITH CHECK (public.is_account_member(account_id, 'admin'::public.account_role_enum));


--
-- Name: whatsapp_config whatsapp_config_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY whatsapp_config_select ON public.whatsapp_config FOR SELECT USING (public.is_account_member(account_id));


--
-- Name: whatsapp_config whatsapp_config_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY whatsapp_config_update ON public.whatsapp_config FOR UPDATE USING (public.is_account_member(account_id, 'admin'::public.account_role_enum));


--
-- PostgreSQL database dump complete
--


