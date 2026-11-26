# 0021 — One ticket per milestone; ports inside screen tickets; the red-CI rule

**Date:** 2026-11-26 · **Status:** accepted (Plan, unattended, on Nimish's instruction) · **Amends:** ADR 0003 §6, ADR 0019 (port order)

## Context
Nimish, 2026-11-26: "it's a very simple admissions management system; most things already exist in wacrm; it's mainly the
backend, fixing the pipeline and the frontend; do not overcomplicate; be efficient and fast; keep the codebase crystal clear."
The plan had eleven component-port tickets (#7–#18) ahead of any admissions behaviour, each with its own seed, build and review,
porting whole platform components whether or not a screen used them.

## Decision 1 — fewest, largest vertical slices
Each remaining milestone is **one build ticket** (M6 is two, because its engine and its 8-tab settings screen are each a full day):

| Milestone | Ticket | Ports folded in |
|---|---|---|
| M1 | #63 theme follow-ups (kept as is), then #18 frame: sidebar, top bar, page head, icon map, the frame's blocks.css | #8, #9, #12 |
| M2 | #65 WhatsApp on the test number | — |
| M3 | #66 pipeline: history, days in stage, Lost reason; S-board card + S-lead panel | #10, #11, #13, #16 |
| M4 | #67 one door: welcome flow, quick-add, website form, campus by DOB | — |
| M5 | #68 booking: Cal.com webhook, reminders, no-show | — |
| M6 | #69 follow-ups + S-today · #70 Admissions Settings | #15 → #69, #14 → #70 |
| M7 | #71 funnel report + sheet import; hosting/go-live via `loop-release`, no ticket | #17 |

#8–#17 are closed as "not planned" with a comment naming the ticket that absorbed them. #7 and #52 are already merged.

- **Reuse first:** a ticket extends wacrm's route, lib or component before writing a new one (board, deal drawer, flows, automation
  queue + cron, contact dedupe, CSV import, settings pages, webhook signature check).
- **Port on demand:** a Cornerstone component is ported inside the screen ticket that first needs it, and only as far as that
  screen uses it (e.g. the icon map carries only the concepts on screen; later tickets add theirs).
- **Budgets:** these tickets are larger than loop-ticket's default (≤3 files, ≤200 lines). Each carries its own `Budget:` line
  (from files≤6 lines≤300 for M2 to files≤16 lines≤1400 for M3); CI's 20% rule applies to that line.
- **Seeds:** each ticket is `queued`. Its seed (`plan/t<N>`: exact file list, skeleton, any migration, failing visible + hidden
  tests) is cut by Plan when its milestone starts, one plan job per milestone. The draft icon table and tests on `plan/t8` are
  the starting point for #18's seed; `plan/t8` itself is not built.

## Decision 2 — the red-CI rule (CLAUDE.md §4)
Red CI: read the failing lines at once. Non-critical (runner or infra flake, port bind, an unrelated flaky upstream test,
cosmetic) → rerun once, then merge with a one-line note in the PR. Critical (data, tenancy/RLS, auth, money, migrations) →
never merged red; fix it.

## Assumptions (Nimish not asked, per his instruction)
- A larger ticket raises the chance of a failed build; accepted for speed. If a slice fails three times, the rescuer may split
  it — Plan then cuts the split, not the builder.
- M6 stays two tickets: one builder session is unlikely to finish the rules engine, Today and an 8-tab settings screen together.
- Milestones keep their numbers and goals; only the ticket breakdown changed. Hosting (G7.3, G7.4) is `loop-release`, not a ticket.
- "Unrelated flaky upstream test" means a wacrm test outside the ticket's files that also fails on main or passes on rerun;
  anything in `tests/db/`, `tests/holdout/` or a migration is critical by definition.

## Consequences
About 9 build tickets left instead of ~17; the frontend uses only the components its screens show. Builders get bigger
contexts, so each seed must name its files exactly.
