# HANDOFF

_Overwritten at the end of every session. Keep under 30 lines. Facts only._

**Updated:** 2026-11-26 · **By:** welcome menu + sheet import (ADR 0035, 0036) · **Model:** claude-opus-5-5
**Milestone:** M7 hosting live for testing; M2 hand checks open · **Branch:** feat/whatsapp-welcome-menu

## State
- Live: https://cornerstone-admissions.vercel.app (Vercel, icn1) on Supabase `bfnrfpuaaifdhlundrum` (Seoul).
  Migrations 001–123 applied. Nimish signs in (owner). pg_cron calls the automations cron every 5 min.
- Old sheet imported (ADR 0036): 59 leads + 3 contact-only records; tags No phone (8), Check phone, Not admissions,
  After-school. No messages sent.
- This branch (ADR 0035): welcome menu (call back / visit / online) → child's name, date of birth → a call on Today or
  the campus's Cal.com link carrying the parent's number and child's name; a scanned QR restarts the menu.
- Cal.com events: `school-visit` (Gurukul), `school-visit-neev`, `online-meeting` (Zoom), one webhook to the app.
- Secrets: Vercel env (META_APP_ID/SECRET set) + local `.env.hosted`. Deploy: `git archive main` → `vercel deploy --prod`.

## Next step
1. After merge and deploy: create the welcome flow on live from the template and activate it; set up follow-up rules
   that need no template (call tasks, Dormant); draft the message templates.
2. Nimish: Settings → WhatsApp on live (phone number id, WABA id, token, verify phrase); Meta webhook callback
   `/api/whatsapp/webhook`. Then submit templates to Meta; template-sending rules only after approval.
3. Test the whole journey from a phone: QR → menu → each branch → card on the board, call on Today, Cal.com booking.

## Blocked / open questions
- DOB cut-offs per campus (until then the campus button or staff pick it). Online meetings land in Visit booked and
  get visit-worded messages. G1.3 raw styles in upstream screens. G7.4 signed-in non-member on live untested.
- Default Supabase email: a few emails per hour; more staff invites need custom SMTP (e.g. Resend).

## Don't repeat
- The hosted DB password contains `%`: pass it raw via PGPASSWORD, never URL-decoded.
- Vercel turns on Authentication for production by default; it blocks webhooks. Keep it on previews only.
- Template-sending follow-up rules before Meta approves the template mark every lead "Not sent" for that stage entry.
