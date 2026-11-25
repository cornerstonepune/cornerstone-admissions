# 0007 — A lead is a deal in the Admissions pipeline plus one `leads` row

**Date:** 2026-11-25 · **Status:** accepted (Plan, unattended; sibling rule is an assumption for Nimish to confirm)

## Context
The brief wants wacrm's pipeline board kept (D1) and adds child fields, source, stage history, a lost reason and two
exits (Lost, Dormant). Upstream `deals` has stage, contact, conversation and `status` open/won/lost, and nothing for
admissions.

## Decision
- A **lead** = one `deals` row in the Admissions pipeline + one `admissions.leads` row 1:1 with it, holding what is ours:
  child name, date of birth, grade, campus, area, source, exit (`lost` | `dormant`, empty while open) and lost reason.
- Stages are `pipeline_stages` rows of the Admissions pipeline (the six in D8, editable in Settings).
- `deals.status` is kept in step so the upstream board works: open while in a stage, `won` at Admitted, `lost` for
  either exit.
- One open lead per contact; contacts are already unique by normalized phone per account.
- **Assumption:** one child per lead. A second child from the same phone is a note on the lead in v1.

## Considered
Adding columns to upstream `deals`: every upstream change to `deals` would conflict with ours. Rejected.

## Consequences
Every lead write touches two rows; the M0 spec puts both behind one database function so they can't drift.
