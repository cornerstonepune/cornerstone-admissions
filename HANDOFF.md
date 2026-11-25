# HANDOFF

_Overwritten at the end of every session. Keep under 30 lines. Facts only._

**Updated:** 2026-11-25 · **By:** Coordinator · **Model:** claude-opus-5-5
**Milestone:** M0 — data model · **Branch:** plan/handoff · **PR:** this one (handoff only)

## State
- Tests: no local `npm test` this session; no product code changed. #20 merged to main (5a80c44) with CI green.
- Last thing done: Nimish cleared M0 to start. `loop plan "M0 data model: to-spec then loop-ticket ..."` is running (Opus, in the main checkout, on branch plan/m0-spec). First attempt was killed by a 590s `timeout` wrapper and left nothing behind.
- No M0 tickets or seed branches existed when this handoff was written.

## Next step
Check the planner's result: `gh issue list` (M0 tickets) and `git branch -r | grep plan/t`. Then build loop per ticket: `loop prep N` → `loop build N` → `loop finish N` → reviewer → merge.

## Blocked / open questions (need Nimish)
- Dependabot PRs #1–#5: recommended close all + delete `.github/dependabot.yml`. Unanswered.
- Assumption, open: staff (kakas, didis) = agent, quick-add only.
- `beyond` runs locally (db 54332) and may clash with local Supabase; M0 runtime check not run.
- M7 hosted Supabase project cost not checked.

## Don't repeat
- Never wrap `loop plan` in a shell `timeout` (it allows itself 90 min); run it in the background instead.
- `loop plan` runs in the main checkout and switches branches: don't switch branches there while it runs (use a worktree).
- Never open the platform repo (ADR 0003) or touch `ruznbyngtfjsaymuylhm` (ADR 0009). Don't stop other projects' Docker containers.
- A helper's port edit of supabase/config.toml was refused (2026-11-25). Ask Nimish, don't route around it.
- The loop guard blocks Bash naming frontend paths or `design/approved.json`, even read-only.

## Files touched this session
HANDOFF.md.
