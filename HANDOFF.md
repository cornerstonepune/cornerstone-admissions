# HANDOFF

_Overwritten at the end of every session. Keep under 30 lines. Facts only._

**Updated:** 2026-11-28 · **By:** School address live · **Model:** claude-sonnet-5-5
**Milestone:** M7 hosting live for testing; M2 hand checks open · **Branch:** docs/school-address

## State
- Live: https://admissions.cornerstoneschool.in (Vercel team `cornerstone-school`, ADR 0042) on Supabase
  `bfnrfpuaaifdhlundrum`. Migrations 001–128 applied. Deployed: 5e8906d, 28 Nov.
- Seen after the release, both addresses: six `/q/` links 302 with their tag, login 200, unsigned webhooks and cron 401.
  The 5-minute job returned 200. Not seen: a signed-in session on the new address, Settings → Sources links there.
- Meta webhook, Cal.com webhook and pg_cron still call cornerstone-admissions.vercel.app (keeps serving).
- Sources on: Gurukul QR, Neev QR, Instagram and Facebook, Events, Website, Referral card (+ WhatsApp, Walk-in, Phone).
  Six final QR codes made and decoded; mail to the admissions team drafted in Gmail, not sent. Not yet phone-scanned.
- WhatsApp: test number 15551642653; a scan arrived as a lead on 27 Nov. That token was temporary: assume expired.
- `SARVAM_API_KEY` now on Vercel under the right name; transcription not tested.
- Deploy: `git archive origin/main` + `.vercel/` → `vercel deploy --prod --scope cornerstone-school`. Migrations: psql.
## Next step
1. Nimish: Supabase Auth → URL Configuration (Site URL `https://admissions.cornerstoneschool.in`, redirect
   `https://admissions.cornerstoneschool.in/**`); scan the six codes; send the mail.
2. Nimish: permanent WhatsApp token (Meta's 7-day wait, about 3 Dec); templates pending; one real Cal.com booking.
3. Move webhooks and pg_cron to the new address. Compact Pipeline numbers. Hand checks: password setup, welcome.
## Blocked / open questions
- Open: Supabase Pro and whether admissions keeps its own database (advised: yes, new one in Mumbai).
- Not built: marking a meeting Visited/No-show, editing or cancelling a staff-added meeting. Hardening follow-up: hosted default grants; some upstream SECURITY DEFINER functions executable by anon.
## Don't repeat
- Hosted DB password contains `%`: pass it raw via PGPASSWORD. Hosted default grants differ from local (LESSONS).
- Lint changed folders, not `npm run lint` (it scans `.claude/worktrees`). Local dev: http://localhost:3000.
