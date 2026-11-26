# ADR 0022: The ticket size budget is a warning, not a CI gate

**Date:** 2026-11-26 · **Decided by:** Nimish (in chat) · **Status:** accepted

## Decision
`loop-guard` prints a warning when a ticket PR is more than 20% over its `Budget:` line, and no longer fails CI for it. The wireframe gate no longer counts test files as screen files.

## Why
After ADR 0021 the tickets are whole milestone slices, so their budgets are rough estimates. Two PRs (#74, #75) went red on these rules only, with every real check green, and each cost a planner session to change a number or a label. The budget is a guess about effort, not a quality check. Tests, the database tests, hidden tests and the reviewer still gate every merge.

## Consequences
A sprawling build is caught by the reviewer (it checks the diff against the ticket), not by CI. Test files under `src/app/**` no longer need a `Screens:` line.
