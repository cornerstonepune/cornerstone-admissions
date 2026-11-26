# ADR 0025: Admissions Settings: value shapes, who edits, and the four upstream tabs

**Date:** 2026-11-26 · **Decided by:** builder for #70 (assumptions, open to Nimish) · **Status:** accepted

## Decision
1. **One API** `/api/admissions/settings` (GET any member; POST, PATCH `[id]` owner/admin). Writes use the caller's RLS
   client, so migration 105's trigger records `auth.uid()` as `changed_by`; TypeScript never writes `settings_changes`.
   Kind and key never change through the API. Settings are switched off (`active = false`), never deleted (ADR 0011 §5).
2. **Value shapes** (ADR 0011 left campus, source and lost reason free):
   - follow-up rule: as migration 100's check; stage is one of the six names (ADR 0014 §9); days 0–365.
     Key = `<stage>_day_<days>_<action>`. A send-template rule whose template is not APPROVED saves switched off.
   - alert: `untouched` = `{threshold: hours 1–168}`; `stuck_<stage>` = `{stage, threshold: days 1–365}`, the shape M3's
     board reads (ADR 0024 §4). The server sets `stage` from the key.
   - campus: `{grades?, born_from?, born_before? (YYYY-MM-DD), visit_link? (https)}`. Source: `{}`, key = its tag.
     Lost reason: `{}`.
3. **Tabs not backed by admissions_settings**: Templates and People show upstream's own `TemplateManager` and
   `MembersTab` (ADR 0014 §6). Stage names are edited in Pipeline and the welcome flow's words in Flows; both tabs link
   there. Those edits go to upstream tables, so they are **not** in the settings change log.

## Considered
- A stage-rename and welcome-words editor here: needs audited writes to upstream tables (`pipeline_stages`, flows) that
  migration 105 doesn't cover, and the welcome flow is built in M4. Deferred.

## Consequences
- M4 (campus by date of birth) reads the campus fields above. M6 #69 (the engine) reads the rule and alert keys above.
- Not built from the wireframe: source QR codes and links (the link format comes with M4), rule Move up/down/Delete.
