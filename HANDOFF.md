# HANDOFF

_Overwritten at the end of every session. Keep under 30 lines. Facts only._

**Updated:** 2026-11-25 21:09 · **By:** Coordinator · **Model:** claude-opus-5-5
**Milestone:** M0 — data model · **Branch:** plan/adopt · **PR:** #20 (CI green, not merged: waits for Nimish's OK)

## State
- Merged today: #6 loop harness, #19 platform design copied once (ADR 0003, port tickets #7–#18 queued behind wireframes).
- PR #20 = loop-adopt: PROJECT.md, db/schema.sql (from a real replay), GLOSSARY.md, ADRs 0004–0008. CI green (`loop ci 20`). Planner's proof: 1728 tests pass, typecheck 0, lint 0 errors, 60 migrations replay on Postgres 17.
- Found: no `account_members` table (membership = `profiles.account_id` + `account_role`, ADR 0006). Upstream `on_auth_user_created` trigger + live signup page: M0 removes both.
- No product code written yet.

## Next step
Nimish reads PROJECT.md on #20 and confirms or corrects the 3 assumptions. Merge on his OK, then `loop plan "M0: to-spec + loop-ticket"` and build M0 tickets.

## Blocked / open questions (need Nimish)
- Assumptions on #20: light mode only (ADR 0008), one child per lead (ADR 0007), role mapping (ADR 0006).
- Local Supabase port clash: `assessment-engine` stack holds 54322. Nimish picks: stop that stack, or move this repo's ports to 553xx in supabase/config.toml via PR (recommended; PROJECT.md §6 plans it). Until then: app-runs-locally and sign-in checks are unverified.
- Dependabot PRs #1–#5 untouched (#2 xyflow 13 and #4 eslint 10 are majors).

## Don't repeat
- A helper's edit of supabase/config.toml ports (scratch worktree) was refused by the permission system on 2026-11-25. Don't retry or route around it without Nimish's OK.
- Never open the platform repo (ADR 0003). Don't stop other projects' Docker containers.
- Loop guard blocks Bash naming frontend paths or `design/approved.json`, even read-only.
- `loop plan` runs in the main checkout and switches branches: don't switch branches there while it runs.

## Files touched this session
HANDOFF.md (coordinator). Planner sessions: see #19, #20.
