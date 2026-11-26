# HANDOFF

_Overwritten at the end of every session. Keep under 30 lines. Facts only._

**Updated:** 2026-11-26 · **By:** Nimish's live feedback built and deployed · **Model:** claude-sonnet-5-5
**Milestone:** M7 hosting live for testing; M2 hand checks open · **Branch:** fix/conversation-grants

## State
- Live: https://cornerstone-admissions.vercel.app (Vercel) on Supabase `bfnrfpuaaifdhlundrum`. Migrations 001–127 applied.
- Live now: lead edit/delete, parent email, stage and campus colours, side-scroll board (ADR 0038); admissions Dashboard
  and visual Report (ADR 0037); Conversations tab: upload, record or type, Sarvam then Claude sections (ADR 0039).
- Security: PRs #100 and #101 independently reviewed and fixed. Imported leads no longer count in dated numbers (#102).
- Deploy: `git archive origin/main` export + `.vercel/` → `vercel deploy --prod`. Migrations: psql with PGPASSWORD.

## Next step
1. Nimish: create `SARVAM_API_KEY` (dashboard.sarvam.ai) and `ANTHROPIC_API_KEY` (console.anthropic.com), add both in
   Vercel → Settings → Environment Variables (Production), redeploy; then log one real call and check the sections.
2. Pipeline board is cramped on a short laptop screen (about two cards per column): compact the numbers above it.
3. Earlier hand checks: password setup, WhatsApp settings and Meta callback, real Cal.com booking, welcome wording.

## Blocked / open questions
- Grade from date of birth needs each campus's cut-off per grade. Seat targets per grade wanted on Dashboard?
- Unverified: real Sarvam/Claude calls (upload method and output shape assumed), phone width and Safari on live.
- Anonymous and signed-in roles hold default grants on hosted tables (RLS protects); some upstream SECURITY DEFINER
  functions are executable by anon: hardening follow-up.

## Don't repeat
- Hosted DB password contains `%`: pass it raw via PGPASSWORD. Hosted default grants differ from local (LESSONS).
- `npm run lint` in the main checkout scans `.claude/worktrees` and hangs: remove old worktrees or lint changed files.
