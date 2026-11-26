# 0032 — Milestone status catch-up (2026-11-26)

**Date:** 2026-11-26 · **Status:** accepted (Nimish asked for PROJECT.md and the handoff to match what is built)

## Context
Building directly (ADR 0023) merged M1 and M3–M7 slices without updating PROJECT.md §5, which still said
"Not started" for M2–M7. HANDOFF.md still described PR #92 as waiting to merge.

## Decision
- §5 shows each milestone's real state. "Built" means merged with CI green; it does not mean Nimish has clicked it
  through (§3: he clicks through after each milestone; production waits for his go).
- A goal is ticked only when a test in the repo names it, or (G1.1 only) a code read confirms it; the note says which.
- G1.3 stays open. CI's raw-style check (`.github/loop/check_pr.py`) runs only on lines a PR adds, so upstream screens
  never got checked. The same rule run over all of `src/` on 2026-11-26 finds 228 lines in 71 of 161 screen files.
- No scope, goal or order changes.

## Consequences
- Open goals: G1.3 (raw colours in upstream screens), G2.1–G2.3 (hand checks on the Meta test number), G4.3 (Nimish
  times quick-add), G7.3–G7.4 (hosting).
