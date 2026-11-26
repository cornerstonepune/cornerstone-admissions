# HANDOFF

_Overwritten at the end of every session. Keep under 30 lines. Facts only._

**Updated:** 2026-11-26 · **By:** hosting live for testing (ADR 0034) · **Model:** claude-opus-5-5
**Milestone:** M7 hosting live for testing; M2 hand checks open · **Branch:** docs/hosting-live

## State
- Live: https://cornerstone-admissions.vercel.app (Vercel, icn1) on Supabase `bfnrfpuaaifdhlundrum` (Seoul).
  Migrations 001–123 applied; schema equals `db/schema.sql` (G7.3). Anonymous key reads zero rows everywhere.
- PR #94 merged (ADR 0033): Cal.com location picks the campus, repeat family notifies the office (once per 24 h),
  new welcome wording. Independently reviewed; 3 findings fixed in migration 123.
- Owner nimish's account (361f5fbb-…) with pipeline and 20 settings; no password yet. pg_cron calls the automations
  cron every 5 min (first run 200). Cal.com: `school-visit` (Gurukul) + `school-visit-neev`, one webhook to the app.
- Secrets: Vercel env + local `.env.hosted` (git-ignored). Deploy: `git archive main` export → `vercel deploy --prod`.

## Next step
1. Nimish: Supabase → Authentication → URL Configuration: Site URL + redirect `https://cornerstone-admissions.vercel.app/**`;
   then Forgot password to set his password; click through M1–M7 on live.
2. Nimish: Settings → WhatsApp on live (phone number id, token, verify phrase); Meta callback URL →
   `/api/whatsapp/webhook` on the live address; then G2.1–G2.3 and a real Cal.com test booking.
3. Approve the welcome wording; real Neev address in Cal.com (keep "Neev" in it).

## Blocked / open questions
- DOB cut-offs per campus (until then staff pick the campus). G1.3 raw styles in upstream screens. G7.4 signed-in
  non-member on live untested. Security-advisor SECURITY DEFINER warnings (mostly upstream): hardening follow-up.
- Default Supabase email: a few emails per hour; more staff invites need custom SMTP (e.g. Resend).

## Don't repeat
- The hosted DB password contains `%`: pass it raw via PGPASSWORD, never URL-decoded.
- Vercel turns on Authentication for production by default; it blocks webhooks. Keep it on previews only.
