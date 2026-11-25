# 0015 — A setting in use keeps its kind and account; a lead with stage history stays put

**Date:** 2026-11-25 · **Status:** accepted (unattended assumption; Nimish can overturn) · **Source:** PR #34 review findings

> §2 superseded by ADR 0016 (account and deal simply never change).

## Context
Migration 103 checks a lead's settings and deal on the lead's side only. Two gaps remained: a setting already used by a lead, visit or activity could later change its `kind` or `account_id`, silently making old rows invalid; and the guard against moving a lead to another account or deal looked at visits and activity but not at `lead_stage_history`, whose rows carry the lead's account.

## Decision
1. **Settings in use (#36, migration 108):** `admissions_settings` rows referenced by `leads.campus_id/source_id/lost_reason_id`, `visits.campus_id` or `lead_activity.rule_id` cannot change `kind` or `account_id` (23514, "A setting in use cannot change its kind or account"). Label, value, active and sort order stay editable. The check is a SECURITY DEFINER trigger so it sees every referencing row; trigger functions can't be called through rpc(), so it answers nothing to anyone.
2. **Lead move guard (#37, migration 109):** `check_lead_integrity` also refuses an account or deal change when the lead has stage history. Since #25 writes a history row when a lead is created, in practice a lead's account and deal are fixed once it exists. That is intended: a wrong lead is closed and a new one made, never re-pointed.
3. #37 also adds regression tests for 103's existing guards: definer helpers refuse rpc probing of other accounts, and visits/activity block a move.

## Consequences
Fixing a mis-typed setting kind means making a new setting and re-pointing the rows. Admin UI (M1+) must not offer kind/account edits on used settings.
