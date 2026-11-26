-- 114 — signed-in users can't SELECT webhook_endpoints.secret through the Data API (#80 security follow-up).
--
-- Every reader of the secret uses the service role (the v1 API's requireApiKey hands routes supabaseAdmin(); the
-- WhatsApp webhook dispatches with its admin client), so authenticated keeps SELECT on every other column only.
-- INSERT/UPDATE/DELETE grants (112) are unchanged: the v1 API writes the encrypted secret with the service role anyway.
-- A column added to webhook_endpoints later needs its own GRANT SELECT here, or authenticated can't read it.
--
-- Not done here, on purpose: whatsapp_config.access_token and ai_configs.api_key. wacrm's own routes read those with
-- the caller's session client (health, react, broadcast, templates, media, AI config/test, the settings screen's
-- select('*')), so revoking them would break those routes until they move to the service role.
REVOKE SELECT ON public.webhook_endpoints FROM authenticated;
GRANT SELECT (id, account_id, created_by, url, events, is_active, last_delivery_at, failure_count, created_at)
  ON public.webhook_endpoints TO authenticated;
