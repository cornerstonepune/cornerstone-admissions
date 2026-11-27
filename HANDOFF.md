# HANDOFF

_Overwritten at the end of every session. Keep under 30 lines. Facts only._

**Updated:** 2026-11-27 · **By:** Permanent QR links live · **Model:** claude-sonnet-5-5
**Milestone:** M7 hosting live for testing; M2 hand checks open · **Branch:** docs/handoff-qr-live

## State
- Live: https://cornerstone-admissions.vercel.app (Vercel) on Supabase `bfnrfpuaaifdhlundrum`. Migrations 001–128 applied.
- Live (416bffa): Calendar (meetings and calls), Cal.com video and new-family leads, source QR links `/q/<tag>` (ADR 0041).
  `ADMISSIONS_WHATSAPP_NUMBER` on Vercel is the test number 15551642653. Seen on live: five links return 302 with their
  tag; Settings → Sources copies the `/q/` address. Not yet seen: a phone scan arriving as a lead.
- Team email sent 27 Nov (old direct-to-WhatsApp codes); follow-up draft with the new codes saved in Gmail, not sent.
- Old sheet's dated events loaded on live: 31 calls made, 8 to make, 4 past visits, 2 meetings on 28 Nov (reminders
  stamped as sent: no messages). Seen signed in on live: November shows 6 visits, 4 calls to make, 31 made.
- Vercel production has `CALCOM_WEBHOOK_SECRET`, `ADMISSIONS_ACCOUNT_ID`, `ANTHROPIC_API_KEY`; not `SARVAM_API_KEY`.
- Deploy: `git archive origin/main` + `.vercel/` → `vercel deploy --prod`. Migrations: psql.
## Next step
1. WhatsApp on live is down (temporary token expired 26 Nov): Nimish saves a permanent token; templates pending. Then
   scan one QR from a test-listed phone and see the lead arrive under its source.
2. Before anything is printed: Nimish decides vercel.app or own domain. At a number change, update the variable and deploy.
3. Nimish: `SARVAM_API_KEY` on Vercel; one real Cal.com visit and video booking with a new phone number.
4. Compact the Pipeline board's numbers. Hand checks: password setup, Meta callback, welcome wording.
## Blocked / open questions
- Not built: marking a meeting Visited/No-show in the app, editing or cancelling a staff-added meeting.
- Unverified: Cal.com's real video payload fields and the child/grade question names; real Sarvam/Claude calls.
- Hardening follow-up: hosted default grants; some upstream SECURITY DEFINER functions executable by anon.
## Don't repeat
- Hosted DB password contains `%`: pass it raw via PGPASSWORD. Hosted default grants differ from local (LESSONS).
- Lint changed folders, not `npm run lint` (it scans `.claude/worktrees`). Local dev: http://localhost:3000.
