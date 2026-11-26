# 0034 — Hosting live for testing

**Date:** 2026-11-26 · **Status:** accepted (Nimish, in chat: "vercel for now", the Supabase project link, "Yes, switch it on")

## Context
M7 hosting. Nimish created the hosted Supabase project `bfnrfpuaaifdhlundrum` ("admissions", region ap-northeast-2,
Seoul) and chose Vercel. CLAUDE.md forbids `supabase db push`; Vercel Hobby crons run once a day; Cal.com rejects
more than one location on an event with seats.

## Decision
- **App:** Vercel project `cornerstone-admissions` (team nimishshah1989s-projects), https://cornerstone-admissions.vercel.app.
  Functions in `icn1` (Seoul, next to the database). Vercel Authentication covers previews only; production is
  guarded by the app's own sign-in (it must be reachable by Meta and Cal.com webhooks). No Git link yet: deploys
  run `vercel deploy --prod` from a `git archive main` export, so only committed files are uploaded.
- **Secrets:** in Vercel env (production, sensitive) and in Nimish's local `.env.hosted` (git-ignored), never in chat.
  `ADMISSIONS_ACCOUNT_ID` = 361f5fbb-ca33-4e88-a19f-6433a34d0412.
- **Migrations:** applied with `psql`, one transaction per file, each recorded in
  `supabase_migrations.schema_migrations` as the CLI would; not `supabase db push`. 001–123 applied.
- **Owner:** created by a one-off hosted copy of `scripts/seed-local.mjs` without sample leads (account, pipeline,
  20 settings, owner with no password; Nimish sets it through Forgot password).
- **Cron:** pg_cron + pg_net in the hosted DB call `/api/automations/cron` every 5 minutes; the secret is in Supabase
  Vault (`automation_cron_secret`). First run returned 200.
- **Cal.com:** two events, because the visit event has seats (2 per slot): `school-visit` (Gurukul, the default) and
  `school-visit-neev`. Each campus setting's `visit_link` points at its event; the location text names the campus,
  which migration 122 reads. One webhook to `/api/admissions/calcom` (created, booked, rescheduled, cancelled, no-show).

## Consequences
- G7.3 holds: the hosted public schema equals `db/schema.sql` except Supabase's own `rls_auto_enable()` and
  `pg_attver` options. G7.4 checked for the anonymous key only (zero rows on every table); a signed-in non-member on
  live is not yet tested.
- Open: Supabase Auth Site URL / redirect URLs (Nimish, dashboard); WhatsApp settings entered on live and Meta's
  callback URL moved; the Neev address in Cal.com is a placeholder; the security advisor's SECURITY DEFINER warnings
  (mostly upstream) are a hardening follow-up; default Supabase email allows only a few emails an hour.
- A Mumbai region would mean recreating the project; Seoul stays for testing.
