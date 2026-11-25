# HANDOFF

_Overwritten at the end of every session. Keep under 30 lines. Facts only._

**Updated:** 2026-11-25 21:45 · **By:** Plan (coordinator) · **Model:** claude-opus-5-5
**Milestone:** M0 — data model · **Branch:** plan/adopt · **PR:** https://github.com/cornerstonepune/cornerstone-admissions/pull/20 (approved by Nimish; NOT merged: GitHub outage)

## State
- Tests: CI green on 78e06f3 (Lint/typecheck/test/build, loop-guard, loop-tests), via `loop ci 20`. The handoff commits after it are docs-only; CI must re-run. No local `npm test` this session.
- Last thing done: the planner applied Nimish's 4 answers to #20: 6 new tables incl. `visits` (ADR 0010), light only (0008), one child per lead (0007), Nimish owner + Akanksha and Lakshmi ma'am admin (0006). Merge then failed 5+ times with HTTP 500/502 (githubstatus.com incident: Issues, PRs, Actions degraded). The retry loop was stopped.

## Next step
githubstatus.com green → `loop ci 20` → `gh pr merge 20 --squash --delete-branch` → `loop plan "M0: to-spec + loop-ticket"` (the spec defines the "current visit" over `visits`).

## Blocked / open questions
- Dependabot PRs #1–#5 come from upstream's `.github/dependabot.yml` (up to 5 a week, reviewer ArnasDon). #2/#3/#4 fail CI, #1/#5 green. Recommended: close all five and delete the file (security alerts stay on). Nimish hasn't answered.
- Staff (kakas, didis) = agent, quick-add only: an assumption, not confirmed.
- `beyond` runs locally (db 54332) and may clash; the M0 runtime check hasn't run. The cost of the M7 hosted Supabase project isn't checked.

## Don't repeat
- Merges during a GitHub incident return 500 on gh and REST: wait for githubstatus.com, no tight retry loop.
- A helper's port edit of supabase/config.toml was refused by permissions; ask Nimish.
- Never open the platform repo (ADR 0003) or touch `ruznbyngtfjsaymuylhm` (ADR 0009). Don't stop other projects' containers.
- The loop guard blocks Bash naming frontend paths or `design/approved.json`. `loop plan` switches branches in the main checkout: don't switch while it runs.

## Files touched this session
- PROJECT.md, CLAUDE.md, GLOSSARY.md, ADMISSIONS_PROJECT.md, docs/adr/0005–0008, 0010: planner, ADR 0009 fold + Nimish's answers
- HANDOFF.md: this handoff
