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
- Port clash cleared for now: Nimish stopped the `assessment-engine` stack (2026-11-25). Next session reruns the M0 runtime check (app on local Supabase, sign-in). The `beyond` stack still runs (db 54332) and may clash on other ports; a permanent port move needs his OK (PROJECT.md §6).
- Dependabot PRs #1–#5 untouched (#2 xyflow 13 and #4 eslint 10 are majors).

- Nimish (2026-11-25, chat): "do we need ~35 tables for this simple project?" The 37 are upstream wacrm's; the 12 new admissions tables in PROJECT.md §3 are too many. Coordinator's proposed cut: ~5 (leads incl. visit + exit, lead_stage_history, one settings table for campuses/sources/lost reasons/rules/alerts, one sends/tasks log, settings_changes). Also asked him: own Supabase project for admissions (drops the move of 37 tables + 60 migrations into `admissions`) vs the brief's shared school project. Fold his answers into #20 (with ADR) before merging.

## Don't repeat
- A helper's edit of supabase/config.toml ports (scratch worktree) was refused by the permission system on 2026-11-25. Don't retry or route around it without Nimish's OK.
- Never open the platform repo (ADR 0003). Don't stop other projects' Docker containers.
- Loop guard blocks Bash naming frontend paths or `design/approved.json`, even read-only.
- `loop plan` runs in the main checkout and switches branches: don't switch branches there while it runs.

## Files touched this session
HANDOFF.md (coordinator). Planner sessions: see #19, #20.
