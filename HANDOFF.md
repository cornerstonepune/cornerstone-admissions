# HANDOFF

_Overwritten at the end of every session. Keep under 30 lines. Facts only._

**Updated:** 2026-11-25 21:40 · **By:** Coordinator · **Model:** claude-opus-5-5
**Milestone:** M0 — data model · **Branch:** plan/adopt · **PR:** #20 (approved by Nimish, CI green on 78e06f3; NOT merged: GitHub outage)

## State
- Merged: #6 loop harness, #19 platform design copy (ADR 0003; port tickets #7–#18 queued behind wireframes).
- #20 = loop-adopt: PROJECT.md, db/schema.sql, GLOSSARY.md, ADRs 0004–0010. Nimish answered all four points in chat on 2026-11-25; all are in the files:
  - 6 new tables (ADR 0010): leads, visits (every Cal.com booking; booking id unique), lead_stage_history, admissions_settings, lead_activity, settings_changes.
  - Light mode only (ADR 0008), one child per lead (ADR 0007), Nimish = owner + Akanksha and Lakshmi ma'am = admin (ADR 0006): accepted.
- Merge of #20 failed 5+ times (GraphQL and REST: HTTP 500/502). githubstatus.com reported an active incident (Issues, Pull Requests, Actions degraded). The background retry loop was stopped at session end.
- No product code written yet.

## Next step
Check githubstatus.com is green → `loop ci 20` (this handoff commit re-runs CI) → `gh pr merge 20 --squash --delete-branch` → `loop plan "M0: to-spec + loop-ticket"` (the M0 spec defines the "current visit" view over `visits`).

## Blocked / open questions (need Nimish)
- Dependabot PRs #1–#5 (from upstream's `.github/dependabot.yml`, up to 5 a week, reviewer ArnasDon): #2/#3/#4 fail CI (major bumps), #1/#5 green. Recommended to him: close all five and delete `.github/dependabot.yml` (security alerts are on separately; automated security-fix PRs are off). He hasn't answered.
- Assumption, open: staff (kakas, didis) = agent, quick-add only. Nimish didn't mention staff.
- `beyond` still runs locally (db 54332) and may clash. The M0 runtime check (app on local Supabase, sign-in) has not run yet.
- New hosted Supabase project at M7: Nimish creates it; cost not checked.

## Don't repeat
- A helper's port edit of supabase/config.toml was refused by the permission system (2026-11-25). Don't route around it; ask Nimish.
- Never open the platform repo (ADR 0003) or touch `ruznbyngtfjsaymuylhm` (ADR 0009). Don't stop other projects' Docker containers.
- The loop guard blocks Bash naming frontend paths or `design/approved.json`, even read-only.
- `loop plan` runs in the main checkout and switches branches: don't switch branches there while it runs.
- During a GitHub incident, merges return 500 on both gh and REST: wait for githubstatus.com, don't retry in a tight loop.

## Files touched this session
PROJECT.md, CLAUDE.md, GLOSSARY.md, ADMISSIONS_PROJECT.md, docs/adr/0005–0008, 0010 (planner); HANDOFF.md.
