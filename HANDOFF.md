# HANDOFF

_Overwritten at the end of every session. Keep under 30 lines. Facts only._

**Updated:** 2026-11-25 21:16 · **By:** Coordinator · **Model:** claude-opus-5-5
**Milestone:** M0 — data model · **Branch:** plan/adopt · **PR:** #20 (not merged: needs the changes below, then Nimish's OK)

## State
- Merged: #6 loop harness, #19 platform design copy (ADR 0003; port tickets #7–#18 queued behind wireframes).
- #20 = loop-adopt: PROJECT.md, db/schema.sql, GLOSSARY.md, ADRs 0004–0009. CI green before the ADR 0009 commit.
- Nimish decided 2026-11-25: admissions gets its own Supabase project (ADR 0009). PROJECT.md, CLAUDE.md data rules and M0 goals are NOT yet updated for it.
- No product code written yet.

## Next step
`loop plan "Fold ADR 0009 and the table cut into PR #20: PROJECT.md §2/§3/§5, CLAUDE.md data rules, brief note; cut new admissions tables to the minimum (see Blocked); list the remaining assumptions in the PR body for Nimish"` → `loop ci 20` → Nimish's OK → merge → `loop plan "M0: to-spec + loop-ticket"`.

## Blocked / open questions (need Nimish)
- Table cut: Nimish says ~35 tables is too many. The 37 are upstream wacrm (stay as they are). Proposed: cut the 12 new admissions tables to ~5 (leads incl. visit + exit + lost reason; lead_stage_history; one settings table for campuses/sources/lost reasons/rules/alerts; one sends-and-calls log; settings_changes). He hasn't explicitly confirmed the 5: planner applies it and shows it on #20 for his OK.
- Still unconfirmed on #20: light mode only (ADR 0008), one child per lead (ADR 0007), role mapping (ADR 0006).
- Port clash cleared: Nimish stopped the `assessment-engine` stack. `beyond` still runs (db 54332) and may clash. The M0 runtime check (app on local Supabase, sign-in) has not run yet.
- New hosted Supabase project at M7: Nimish creates it; cost not checked. Dependabot PRs #1–#5 untouched.

## Don't repeat
- A helper's port edit of supabase/config.toml was refused by the permission system (2026-11-25). Don't route around it; ask Nimish.
- Never open the platform repo (ADR 0003) or touch `ruznbyngtfjsaymuylhm` (ADR 0009). Don't stop other projects' Docker containers.
- The loop guard blocks Bash naming frontend paths or `design/approved.json`, even read-only.
- `loop plan` runs in the main checkout and switches branches: don't switch branches there while it runs.

## Files touched this session
HANDOFF.md, docs/adr/0009-own-supabase-project.md. Planner sessions: see #19, #20.
