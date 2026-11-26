# 0026 — Secret columns: lock down the webhook secret now; WhatsApp and AI keys wait for a server-side move

**Date:** 2026-11-26 · **Status:** accepted for webhook_endpoints; the rest open (builder, #80 security follow-up)

## Context
Migration 112 granted SELECT on every upstream table to `authenticated`, so any signed-in member can read
`whatsapp_config.access_token`, `ai_configs.api_key` and `webhook_endpoints.secret` through the Data API (RLS limits
this to their own account). All three are stored encrypted with the server's `ENCRYPTION_KEY`, but still shouldn't be
readable by viewers and agents. Column privileges can't tell admin from agent: both are the `authenticated` role.

## Decision
- **webhook_endpoints.secret (migration 114):** `authenticated` loses SELECT on the table and gets SELECT on every
  other column. Safe because every reader of the secret uses the service role (`requireApiKey` → `supabaseAdmin()`,
  the WhatsApp webhook's admin client). Test: `tests/db/upstream-grants.test.ts`.
- **whatsapp_config.access_token, ai_configs.api_key:** not revoked. wacrm's own routes read them with the caller's
  session client: `api/whatsapp/{health,react,broadcast,media/[mediaId],config,config/verify-registration,templates/*}`,
  `lib/whatsapp/{send-message,broadcast-core,broadcast-resume}` callers, `components/settings/whatsapp-config.tsx`
  (browser, `select('*')`), `api/ai/{config,test}`. Revoking would break sending, reactions, broadcasts, template
  sync and the AI settings until those reads move to the service role after their role check.

## Consequences
- Open: a follow-up that moves those reads to the service role (and the settings screen to explicit columns), then
  revokes the two columns the same way as 114. Best done with M2 (WhatsApp on the test number), when sending can be
  checked end to end.
- A column added to `webhook_endpoints` later needs its own `GRANT SELECT (col)` to `authenticated`.
