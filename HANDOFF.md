# HANDOFF

_Overwritten at the end of every session. Keep under 30 lines. Facts only._

**Updated:** 2026-11-27 · **By:** Calendar of meetings (ADR 0040) · **Model:** claude-opus-5-5
**Milestone:** M7 hosting live for testing; M2 hand checks open · **Branch:** main (PR #104 merged)

## State
- Live: https://cornerstone-admissions.vercel.app (Vercel) on Supabase `bfnrfpuaaifdhlundrum`. Migrations 001–128 applied.
- Live now (deployed bb08500): Calendar (`/calendar`), meetings of three kinds (campus, video, phone) as visit rows
  (migration 128), "Meeting set on this call" in the call form, Cal.com files video bookings as video calls, a family
  new to us who books on Cal.com (the website embeds it) becomes a lead (ADR 0040). Live grants match local.
- Vercel production has `CALCOM_WEBHOOK_SECRET`, `ADMISSIONS_ACCOUNT_ID`, `ANTHROPIC_API_KEY`; not `SARVAM_API_KEY`.
- Deploy: `git archive origin/main` export + `.vercel/` → `vercel deploy --prod`. Migrations: psql with PGPASSWORD.

## Next step
1. Nimish: book one visit and one video call on the website with a new phone number; check both land on the Calendar
   with the right kind and a new lead (source Website). Check Cal.com's webhook points at the live app.
2. Nimish: add `SARVAM_API_KEY` on Vercel (Production) and redeploy; log one real call and check the sections.
3. Pipeline board is cramped on a short laptop screen: compact the numbers above it.
4. Earlier hand checks: password setup, WhatsApp settings and Meta callback, welcome wording.

## Blocked / open questions
- Not built: marking a meeting Visited/No-show in the app, editing or cancelling a staff-added meeting.
- Unverified: Cal.com's real video payload fields and the child/grade question names; real Sarvam/Claude calls.
- Grade from date of birth needs each campus's cut-off per grade. Seat targets per grade wanted on Dashboard?
- Hardening follow-up: hosted default grants; some upstream SECURITY DEFINER functions executable by anon.

## Don't repeat
- Hosted DB password contains `%`: pass it raw via PGPASSWORD. Hosted default grants differ from local (LESSONS).
- `npm run lint` in the main checkout scans `.claude/worktrees` and hangs: remove old worktrees or lint changed files.
- Local dev in the browser pane: use http://localhost:3000, not 127.0.0.1 (Next dev's HMR socket fails there and the
  page reloads, eating input).
- `tests/holdout/db/visits.test.ts` pins `lead_current_visit`'s columns: read new visit columns from `visits` instead.
