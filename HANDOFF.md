# HANDOFF

_Overwritten at the end of every session. Keep under 30 lines. Facts only._

**Updated:** 2026-11-25 · **By:** Planner · **Model:** claude-opus-5-5
**Milestone:** M0 — data model · **Branch:** plan/adopt · **PR:** #20 (four points decided by Nimish; ready to merge when CI is green)

## State
- Merged: #6 loop harness, #19 platform design copy (ADR 0003; port tickets #7–#18 queued behind wireframes).
- #20 = loop-adopt: PROJECT.md, db/schema.sql, GLOSSARY.md, ADRs 0004–0010.
- Nimish decided all four #20 points on 2026-11-25, now in the files:
  - 6 new tables, not 5: `visits` added (every Cal.com booking, reschedule, cancel, no-show; booking id unique; current visit derived). ADR 0010 renamed `0010-six-admissions-tables.md`; PROJECT.md §3 entities, invariant 6, M0 Delivers/G0.1, CLAUDE.md, brief note updated.
  - Light mode only: ADR 0008 accepted by Nimish.
  - One child per lead: ADR 0007 accepted by Nimish.
  - Roles: Nimish = owner, Akanksha and Lakshmi ma'am = admin (full access). ADR 0006 and PROJECT.md §1/§2 updated.
- No product code written yet.

## Next step
`loop ci 20` → merge #20 → `loop plan "M0: to-spec + loop-ticket"` (the M0 spec defines the "current visit" view over `visits`).

## Blocked / open questions (need Nimish)
- Assumption, open: staff (kakas, didis) = agent, quick-add only. Nimish didn't mention staff.
- `beyond` still runs locally (db 54332) and may clash. The M0 runtime check (app on local Supabase, sign-in) has not run yet.
- New hosted Supabase project at M7: Nimish creates it; cost not checked. Dependabot PRs #1–#5 untouched.

## Don't repeat
- A helper's port edit of supabase/config.toml was refused by the permission system (2026-11-25). Don't route around it; ask Nimish.
- Never open the platform repo (ADR 0003) or touch `ruznbyngtfjsaymuylhm` (ADR 0009). Don't stop other projects' Docker containers.
- The loop guard blocks Bash naming frontend paths or `design/approved.json`, even read-only.
- `loop plan` runs in the main checkout and switches branches: don't switch branches there while it runs.

## Files touched this session
PROJECT.md, CLAUDE.md, GLOSSARY.md, ADMISSIONS_PROJECT.md, docs/adr/0006, 0007, 0008, 0010 (renamed to six), HANDOFF.md.
