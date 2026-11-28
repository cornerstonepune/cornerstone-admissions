# 0042 — The tool's address is admissions.cornerstoneschool.in, under the school's Vercel team

**Date:** 2026-11-28 · **Status:** accepted (Nimish, in chat: moved the projects, asked for the school address, final QR codes on it). Updates 0034.

## Context
The live address and every source QR code (ADR 0041) pointed at `cornerstone-admissions.vercel.app`. Printed codes
cannot change, and the Vercel project sat in a personal team.

## Decision
- **Hosting:** Vercel team `cornerstone-school` ("Cornerstone School"). Same project, same environment variables.
- **Address:** `https://admissions.cornerstoneschool.in`, also `NEXT_PUBLIC_SITE_URL`. Final QR codes hold
  `https://admissions.cornerstoneschool.in/q/<tag>`.
- **DNS** (at GoDaddy, added by the school team): CNAME `admissions` → the project's Vercel target, plus a `_vercel`
  TXT record proving ownership. The apex domain was not moved between Vercel teams; the website's records are untouched.
- **The old vercel.app address keeps serving.** Meta's webhook, Cal.com's webhook and the database's 5-minute job
  still call it; move them one at a time when convenient.

## Consequences
- **Printed codes depend on the domain staying registered and the `admissions` record staying.** Removing either kills
  them. A change of host means editing that record, not reprinting.
- Sign-in sessions are per address: staff sign in once more on the new one.
- Supabase Auth must list the new address (Site URL and redirect URLs) for emailed password links to land there.
