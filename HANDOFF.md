# HANDOFF

_Overwritten at the end of every session. Keep under 30 lines. Facts only._

**Updated:** 2026-11-25 · **By:** Planner · **Model:** claude-opus-5-5
**Milestone:** M0 — data model · **Branch:** plan/adopt · **PR:** #20 (not merged: waits for Nimish's OK on the four points in its body)

## State
- Merged: #6 loop harness, #19 platform design copy (ADR 0003; port tickets #7–#18 queued behind wireframes).
- #20 = loop-adopt: PROJECT.md, db/schema.sql, GLOSSARY.md, ADRs 0004–0010.
- ADR 0009 (own Supabase project) folded into PROJECT.md §2/§3/§5, CLAUDE.md data rules, brief note; ADR 0005 marked partly superseded. G0.1 rewritten (plain `supabase db reset`), G0.5 now just `npm test`, G7.3/G7.4 rewritten, invariant 1 now invite-only.
- ADR 0010: M0 adds 5 tables (leads, lead_stage_history, admissions_settings, lead_activity, settings_changes); invariants 6–7 updated.
- No product code written yet.

## Next step
`loop ci 20` → Nimish's OK on the PR body (5 tables, light only, one child per lead, roles) → merge → `loop plan "M0: to-spec + loop-ticket"`.

## Blocked / open questions (need Nimish)
- Unconfirmed on #20: the 5-table cut (ADR 0010), light mode only (ADR 0008), one child per lead (ADR 0007), role mapping (ADR 0006).
- Port clash cleared: Nimish stopped the `assessment-engine` stack. `beyond` still runs (db 54332) and may clash. The M0 runtime check (app on local Supabase, sign-in) has not run yet.
- New hosted Supabase project at M7: Nimish creates it; cost not checked. Dependabot PRs #1–#5 untouched.

## Don't repeat
- A helper's port edit of supabase/config.toml was refused by the permission system (2026-11-25). Don't route around it; ask Nimish.
- Never open the platform repo (ADR 0003) or touch `ruznbyngtfjsaymuylhm` (ADR 0009). Don't stop other projects' Docker containers.
- The loop guard blocks Bash naming frontend paths or `design/approved.json`, even read-only.
- `loop plan` runs in the main checkout and switches branches: don't switch branches there while it runs.

## Files touched this session
PROJECT.md, CLAUDE.md, ADMISSIONS_PROJECT.md, docs/adr/0005, docs/adr/0010 (new), HANDOFF.md.
