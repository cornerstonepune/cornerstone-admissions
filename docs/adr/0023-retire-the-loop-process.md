# ADR 0023: Retire the loop process; build directly

**Date:** 2026-11-26 · **Decided by:** Nimish (in chat) · **Status:** accepted · **Supersedes:** the process parts of ADRs 0019, 0021, 0022

## Decision
Stop running the loop (planner sessions, seed branches, hidden tests per ticket, size budgets, loop-guard CI). Build each milestone directly on a branch with its tests, open a PR, merge when CI is green. CI keeps every real check: lint, typecheck, unit tests, build, database tests (including the existing hidden tests, which stay as normal tests) and migrations replayed on a clean database. loop-guard is removed from CI.

## Why
Nimish: "a very simple admissions management system", most of it already in wacrm. Over one day, most of the elapsed time went to the loop's own gates (permission false alarms, Blocked-section parsing, size budgets, Screens labels, Plan-base drift), each costing a planner session, not to the product.

## Consequences
Speed depends on the builder writing tests alongside the code. Security-critical changes (RLS, auth, webhooks, migrations) still get a fresh-context review before merge. Data rules in CLAUDE.md (own Supabase project, no live keys, never db push) are unchanged.
