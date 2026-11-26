# ADR 0025: Admissions Settings: value shapes, who edits, and the four upstream tabs

**Date:** 2026-11-26 · **Decided by:** builder for #70 (assumptions, open to Nimish); §2 amended after the #81 review;
§3 confirmed by Nimish · **Status:** accepted

## Decision
1. **One API** `/api/admissions/settings` (GET any member; POST, PATCH `[id]` owner/admin). Writes use the caller's RLS
   client, so migration 105's trigger records `auth.uid()` as `changed_by`; TypeScript never writes `settings_changes`.
   Kind never changes through the API. Settings are switched off (`active = false`), never deleted (ADR 0011 §5).
2. **Value shapes** (ADR 0011 left campus, source and lost reason free). *Amended after the #81 review:* rules and stuck
   alerts hold a **stage id**, not a stage name, so renaming a stage in Pipeline breaks neither.
   - follow-up rule: as migration 100's check, with `stage` = the stage's id (still a string, so no migration); days
     0–365. Key = `rule_<stage id>_d<days>_<action>[_<template>]`: every field that defines the rule, recomputed when the
     rule is edited, so two rules doing the same thing clash (409) and a stale key never blocks a new rule.
     A send-template rule whose template is not APPROVED saves switched off; a failed template lookup answers 500.
   - alert: `untouched` = `{threshold: hours 1–168}`; `stuck_<stage id, - as _>` = `{stage: <stage id>, threshold: days
     1–365}`. The server sets `stage` from the key. This amends ADR 0024 §4 (stage name): M3's `stuckAfterByStage`
     matches the id, and still reads a name for older rows.
   - The API refuses a rule or stuck alert whose stage is not a stage of one of the caller's pipelines.
   - campus: `{grades?, born_from?, born_before?, visit_link? (https)}`; dates are real calendar dates (YYYY-MM-DD) and
     `born_from` is earlier than `born_before`. Source: `{}`, key = its tag. Lost reason: `{}`.
   - A name with no Latin letters (Marathi, say) gets a generated key, `<kind>_<8 hex>`.
3. **Tabs not backed by admissions_settings** — *Confirmed by Nimish, 2026-11-26.* Templates and People show upstream's
   own `TemplateManager` and `MembersTab` (ADR 0014 §6). Stage names are edited in Pipeline and the welcome flow's words
   in Flows; both tabs link there. Those edits go to upstream tables, so they are **not** in the settings change log.

## Considered
- A stage-rename and welcome-words editor here: needs audited writes to upstream tables (`pipeline_stages`, flows) that
  migration 105 doesn't cover, and the welcome flow is built in M4. Deferred.
- Keeping stage names and rewriting them on rename with a trigger on `pipeline_stages`: needs a migration, and two
  pipelines with the same stage name would rewrite each other's settings. Stage ids need neither.

## Consequences
- M4 (campus by date of birth) reads the campus fields above. M6 #69 (the engine) reads rules and stuck alerts by
  stage id.
- A stage that is deleted leaves its rules showing "Removed stage"; they can still be switched off.
- Not built from the wireframe: source QR codes and links (the link format comes with M4), rule Move up/down/Delete.
