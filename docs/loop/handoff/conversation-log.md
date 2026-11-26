# Handoff — Conversation log (branch feat/conversation-log, ADR 0039)

## What I did
- Migration 125: `lead_conversations` (RLS like `lead_activity`), private bucket `conversation-audio` (50 MB, phone and
  browser audio types, account-folder policies), `redeem_invitation` counts the new table.
- `src/admissions/lib/sarvam.ts` (batch job: create, upload, start, poll, download; `saaras:v4`, translate),
  `conversation-extract.ts` (Claude `claude-sonnet-5-5`, JSON schema, validation, fixed concern list),
  `conversations.ts` (state machine, lock, retries, call tasks, 12-month audio retention), `audio.ts` (types).
- Routes under `/api/admissions/leads/[id]/conversations`: GET (list + signed audio URLs + check now), POST (log),
  `upload` (signed upload URL), `[cid]/retry`. The automations cron runs `runConversationJobs()`.
- UI: `src/admissions/components/lead-conversations.tsx`; the lead panel gets a Conversations tab and "Log a call"
  opens it. The Calls tab and its outcome log are unchanged.

## Results
- `npm test` 198 files / 2118 tests pass; typecheck clean; lint 0 errors; build passes (CI dummy env).
- DB tests (`tests/db/conversations.test.ts`, updated count in `tests/db/migrations.test.ts`) written but not run
  locally (Docker was held for another builder); CI runs them.

## Not done / unverified
- No real Sarvam or Claude call made (no keys). Unverified: Azure blob PUT for Sarvam's upload URL, Sarvam's output file
  shape, extraction quality.
- Not clicked through in a browser.
- Keys to add on Vercel (Production + Preview): `SARVAM_API_KEY`, `ANTHROPIC_API_KEY`.

## Security review fixes
- Migration 125 edited in place: no UPDATE for staff, column-limited INSERT as oneself, `audio_path` folder CHECK,
  `conversation_audio_to_sweep()` (service role) for old and orphaned audio. Runner re-checks the path; retry writes with
  the service role; lead DELETE removes the lead's audio folder; call-task errors are shown on the row.
- Local: `npm run db:reset`, `npm run test:db` 35 files / 276 tests pass; `db:schema` regenerated; `npm test`
  199 files / 2146 tests; typecheck, lint (0 errors), build pass.
