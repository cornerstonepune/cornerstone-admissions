# 0012 — Grant table access explicitly in our migrations; RLS narrows it

**Date:** 2026-11-25 · **Status:** accepted (Plan, unattended)

## Context
Verifying the M0 seeds showed that this Supabase (CLI 2.109.0, local) gives new `public` tables and views no
SELECT/INSERT/UPDATE/DELETE for `authenticated` or `anon` (`\dp deals` → `authenticated=Dxtm`). Postgres checks table
grants before RLS, so policies alone end in "permission denied". Every one of the 43 `public` tables is affected,
upstream ones included: upstream wacrm was written for Supabase's older default grants.

## Decision
1. Every migration that creates an admissions table or view grants access explicitly:
   `GRANT SELECT, INSERT, UPDATE, DELETE … TO authenticated` and `GRANT ALL … TO service_role` on tables,
   `GRANT SELECT … TO authenticated, service_role` on views. Nothing to `anon`.
2. Grants stay broad and RLS does the narrowing, so a refused UPDATE/DELETE touches 0 rows instead of raising.
   Append-only and read-only rules (`lead_stage_history`, `settings_changes`) live in the policies, not the grants.
3. M0: migration 101 (#22) grants the six tables; 106 (#27) grants its view, and #27 is blocked by #22.

## Consequences
- Upstream tables still have no grants for `authenticated` locally, so the upstream app can't read or write through
  the Data API against local Supabase. Open: before the first milestone that clicks through upstream screens, plan a
  grants migration for the upstream tables (and check the hosted project's default at M7, ADR 0009).
- CI's Supabase CLI may differ; explicit grants are correct either way.
