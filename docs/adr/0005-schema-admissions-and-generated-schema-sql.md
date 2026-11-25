# 0005 — Schema `admissions` by rewrite at apply time; `db/schema.sql` is generated

**Date:** 2026-11-25 · **Status:** partly superseded by ADR 0009 (points 1, 2's schema and 4 no longer apply; tables stay in `public`). Point 3, the generated `db/schema.sql`, stands with `--schema=public`.

## Context
Upstream's 60 migrations create 37 tables plus their functions and policies in `public` (213 `public.` references plus
unqualified names). Go-live (M7) shares a Supabase project with the Cornerstone platform, so every object of ours must sit
in its own schema. The loop needs one runnable file for the data model.

## Decision
1. **Upstream migrations are never hand-edited.** One apply script rewrites `public.` to `admissions.` and runs each file
   with `search_path = admissions, extensions`, recording it in `admissions.schema_migrations`. It is re-run when pulling
   upstream. Never `supabase db push`.
2. **Our migrations** live in `supabase/migrations/` numbered from 100, written directly against `admissions`.
3. **`db/schema.sql` is generated, never hand-edited**: replay all migrations on a fresh local Postgres 17, then
   `pg_dump --schema-only --no-owner --no-privileges --schema=<schema>`. The first version (2026-11-25) is upstream's
   `public` as it is today; M0 regenerates it from `admissions`. Every migration PR regenerates it in the same PR.
4. All three Supabase clients (browser, server, admin) set `db: { schema: 'admissions' }`.

## Considered
- Hand-qualifying upstream files: every upstream pull becomes a merge conflict across 60 files. Rejected.
- Writing `db/schema.sql` by hand: it drifts from the migrations. Rejected.

## Consequences
Upstream CI `Migrations` still replays the raw files into `public`, which proves upstream SQL is valid but not that our
rewrite works; M0 adds a DB test job for that (G0.6).
