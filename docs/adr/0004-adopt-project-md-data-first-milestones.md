# 0004 — PROJECT.md is the blueprint; milestones resequenced data-first

**Date:** 2026-11-25 · **Status:** accepted (Plan, unattended; Nimish to confirm on the adopt PR)

## Context
`ADMISSIONS_PROJECT.md` v2.1 was the build's spec. The loop needs one locked blueprint (`PROJECT.md`) and fixes the
order: M0 is the data model, nothing else until it merges. The brief's own M0 (repo, harness) is already done, and its
data work is spread across M1 (schema move), M3 (stage history, child fields, lost reason) and M6 (settings tables).

## Decision
- `PROJECT.md` replaces the brief as the blueprint. The brief stays in the repo as history, with a pointer at the top;
  where they differ, `PROJECT.md` and its ADRs win.
- The brief's M0 becomes **M-done**.
- New **M0 = the whole admissions data model**: the move to schema `admissions` (brief M1's schema half) plus every
  table later milestones need (brief M3 and M6 data), with invariant tests.
- The brief's M1 theme half becomes **M1 — Look and frame**. M2–M7 keep their brief numbers and goals, minus the
  data work M0 now does.

## Why
Building the schema once, with its invariants tested, before any screen, stops later milestones from reshaping tables
under UI already built. Keeping M2–M7 numbering means the brief's §10 "needed from Nimish, before Mx" still lines up.

## Consequences
M0 is bigger than a usual milestone; `to-spec`/`loop-ticket` split it into small tickets. Table names in PROJECT.md §3
are provisional until the M0 spec fixes them.
