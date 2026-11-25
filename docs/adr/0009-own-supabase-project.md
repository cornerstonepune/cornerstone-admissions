# 0009 — Admissions gets its own Supabase project

**Date:** 2026-11-25 · **Status:** accepted (Nimish, in chat: "Own project")

## Context
Brief v2.1 put admissions inside the school's existing Supabase project (`ruznbyngtfjsaymuylhm`), shared with the platform. To fence it off, ADR 0005 required every DB object in schema `admissions`, so M0 had to move wacrm's 37 tables out of `public`, rewrite its 60 migrations, and keep rules such as no trigger on `auth.users`. Nimish asked why the data model is so big. Offered own project vs shared, he chose own project.

## Decision
- Admissions runs on its own Supabase project: local Supabase until M7, then a new hosted project that Nimish creates.
- This repo never uses the shared project `ruznbyngtfjsaymuylhm`, at any milestone.
- Supersedes the schema-placement part of ADR 0005 and the brief rules that existed only to protect the shared project. Upstream tables stay in `public`; ours go in `public` too unless the M0 spec finds a reason not to. The `admissions-` bucket prefix and the no-trigger-on-`auth.users` rule are no longer isolation requirements. Self sign-up stays off (invite only).

## Consequences
- M0 shrinks: no move of upstream tables, no rewrite of upstream migrations; G0.1 and G0.5 drop or change. Future wacrm updates merge more easily.
- M7: G7.3 and G7.4 (platform table counts, platform users) become moot; creating the new project, and its cost (not checked), are added.
- A Plan session must update PROJECT.md §2, §3, §5, CLAUDE.md "Data rules" and the brief. Not done in this ADR.
