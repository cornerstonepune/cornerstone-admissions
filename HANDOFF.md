# HANDOFF

_Overwritten at the end of every session. Keep under 30 lines. Facts only._

**Updated:** 2026-11-25 · **By:** Plan · **Model:** claude-opus-5-5
**Milestone:** M0 — data model · **Branch:** plan/adopt · **PR:** #20 (CI green, not merged: waits for Nimish's OK)

## State
- loop-adopt done: `PROJECT.md` §1–6 written (brief v2.1 is now history), `db/schema.sql` generated from a real replay, `GLOSSARY.md`, ADRs 0004–0008.
- Proof run today: `npm test` 160 files / 1728 tests pass; typecheck exit 0; lint 0 errors / 40 warnings; all 60 upstream migrations replay on fresh Postgres 17 and `supabase/ci/verify-schema.sql` passes; 37 tables, RLS on all.
- Found: no `account_members` table exists. Membership is `profiles.account_id` + `account_role`. CLAUDE.md and the brief are corrected (ADR 0006).
- Found: the `on_auth_user_created` trigger makes a new account for every sign-up, and the signup page is live. M0 removes both.
- Milestones resequenced: M-done = fork/harness/design copy; M0 = whole admissions data model; M1 = look and frame (ADR 0004).

## Next step
Nimish reads PROJECT.md on PR #20 and corrects it; merge after his OK. Then `loop plan "M0: to-spec + loop-ticket"`.

## Blocked / open questions
- Local Supabase can't start on default ports: another project (`supabase_db_assessment-engine`) holds 54322. Today's replay used a scratch copy on port 54392. M0 should give this repo its own ports (PROJECT.md §6).
- Not verified: the app running locally, and a user signing in. Built screens have no wireframe snapshots yet; take them once the app runs, then Nimish runs `loop approve --all`.
- Assumptions for Nimish: light mode only (ADR 0008); one child per lead (ADR 0007); role mapping (ADR 0006).

## Don't repeat
- Never open the platform repo (ADR 0003). Don't stop other projects' Docker containers.
- The loop guard blocks any Bash command that mentions `design/approved.json`, even to read it.

## Files touched this session
PROJECT.md, GLOSSARY.md, HANDOFF.md, CLAUDE.md (2 lines), ADMISSIONS_PROJECT.md (history note), db/schema.sql (new), docs/adr/0004–0008 (new).
