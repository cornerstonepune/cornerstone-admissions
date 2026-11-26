# 0039 — Conversation log: Sarvam transcribes, Claude breaks it into sections

**Date:** 2026-11-26 · **Status:** accepted (Nimish approved the goal and chose Sarvam)

## Context
Staff talk to families by phone, on campus visits and in meetings, from enquiry until the child is admitted or the lead
dies. None of it was on the lead beyond a one-line call outcome. The goal: every conversation is logged on the lead,
transcribed, and broken into sections staff can scan. Calls are in code-mixed Hindi, Marathi and English and run 5–20
minutes.

## Decision
- **A seventh admissions table, `lead_conversations`** (migration 124), beside ADR 0010's six: kind (call, visit,
  meeting, note), when, who, the audio path or a typed note, a status, the English transcript and the sections
  (summary, concerns, questions, action points, interest, suggested stage). Same RLS as `lead_activity`. Audio sits in a
  private bucket `conversation-audio` at `<account>/<lead>/<uuid>.<ext>`, 50 MB, phone and browser audio types;
  members read, agent+ upload, admin deletes. `redeem_invitation` counts the new table as account data.
- **Sarvam for speech** (`saaras:v4`, `mode: translate`, `language_code: unknown`): built for Indian languages and
  code-mixed speech, detects the language, and returns English directly. Its synchronous endpoint stops at 30 s, so
  every recording uses the **batch job API** (create → upload to the job's blob URL → start → poll → download). Docs:
  https://docs.sarvam.ai/api-reference-docs/api-guides-tutorials/speech-to-text/batch-api.
  Only the English transcript is kept; the original-language one would need a second job (a `shortcut:` in code).
- **Claude for sections** (`claude-sonnet-5-5`, JSON-schema structured output, server-side refusal fallback). The
  answer is validated in code before it is saved.
- **A fixed concern list in code**: fees, distance/transport, curriculum/board, teachers/quality, safety, facilities,
  timings, age/grade eligibility, admission process, comparing other schools, other. Moves to admissions settings when
  staff want to edit it.
- **Asynchronous jobs, no new scheduler.** The browser uploads straight to Storage with a signed upload URL, then logs
  the conversation; the server starts processing after the response (`after()`). Opening the Conversations tab checks
  anything still in progress, and the existing automations cron (pg_cron, every 5 minutes) finishes the rest. A
  10-minute lock (`claimed_at`) stops two runs working one row. Each stage gets 3 tries, then the row shows
  "Failed — Retry" with the reason. A failure never touches the audio.
- **Without keys the feature still works as a log**: audio and notes save; rows wait with "Transcription not set up" or
  "Analysis not set up" and are processed once the key is added.
- **Action points the school owns become call tasks** on the lead (at most 5 per conversation, due on the agreed date or
  tomorrow), so they reach the Today list.
- **Privacy:** audio is never public; playback uses 10-minute signed URLs; no transcript or personal data is logged.
  The form reminds staff to tell the parent the call is recorded. **Retention:** the cron deletes audio 12 months after
  upload and keeps the text.

## Consequences
- Two new secrets on Vercel: `SARVAM_API_KEY`, `ANTHROPIC_API_KEY`.
- `tests/db/migrations.test.ts` now expects 7 admissions tables (44 in `public`), not 6.
- Unverified until real keys exist: the blob upload method (Azure Put Blob with `x-ms-blob-type: BlockBlob`; Sarvam's
  docs don't state it), the exact shape of Sarvam's output file, and real-world extraction quality.
- Deleting a lead (admin only) deletes its conversations but leaves their audio files in the bucket; retention can't
  find them once the row is gone. Clean up by folder if it matters.
