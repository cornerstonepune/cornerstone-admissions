# HANDOFF

_Overwritten at the end of every session. Keep under 30 lines. Facts only._

**Updated:** 2026-11-27 · **By:** Old-sheet events loaded; calls on the Calendar (ADR 0040) · **Model:** claude-sonnet-5-5
**Milestone:** M7 hosting live for testing; M2 hand checks open · **Branch:** feat/calendar-calls

## State
- Live: https://cornerstone-admissions.vercel.app (Vercel) on Supabase `bfnrfpuaaifdhlundrum`. Migrations 001–128 applied.
- Live (bb08500): Calendar, three meeting kinds, meetings set on a call, Cal.com video calls and new-family leads.
- Loaded on live (data only): the old sheet's dated events, 31 calls made, 8 calls to make, 4 past visits, 2 meetings on
  28 Nov (reminders stamped as sent, so no messages). This branch shows calls on the Calendar; merge and deploy.
- Vercel production has `CALCOM_WEBHOOK_SECRET`, `ADMISSIONS_ACCOUNT_ID`, `ANTHROPIC_API_KEY`; not `SARVAM_API_KEY`.
- Deploy: `git archive origin/main` + `.vercel/` → `vercel deploy --prod`. Migrations: psql.
## Next step
1. Nimish: book one visit and one video call on the website with a new phone number; check both land on the Calendar
   with the right kind and a new lead (source Website). Check Cal.com's webhook points at the live app.
2. Nimish: add `SARVAM_API_KEY` on Vercel (Production) and redeploy; log one real call and check the sections.
3. Pipeline board is cramped on a short laptop screen: compact the numbers above it.
4. Earlier hand checks: password setup, WhatsApp settings and Meta callback, welcome wording. Close PR #105.
## Blocked / open questions
- Not built: marking a meeting Visited/No-show in the app, editing or cancelling a staff-added meeting.
- Unverified: Cal.com's real video payload fields and the child/grade question names; real Sarvam/Claude calls.
- Grade cut-offs per campus; seat targets on Dashboard?
- Hardening follow-up: hosted default grants; some upstream SECURITY DEFINER functions executable by anon.
## Don't repeat
- Hosted DB password contains `%`: pass it raw via PGPASSWORD. Hosted default grants differ from local (LESSONS).
- Lint changed folders, not `npm run lint` (it scans `.claude/worktrees`). Local dev: http://localhost:3000.
- `tests/holdout/db/visits.test.ts` pins `lead_current_visit`'s columns: read new visit columns from `visits`.
