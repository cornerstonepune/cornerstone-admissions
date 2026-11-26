# 0024 — M3 pipeline: upstream grants, one atomic lead move, days in stage as a field, the stuck setting

**Date:** 2026-11-26 · **Status:** accepted (builder for #66; grants decided by the coordinator; the rest are assumptions Nimish can overturn)

## Context
M3 (#66) is the first milestone that clicks through an upstream screen (the pipeline board) against local Supabase.
Three gaps showed up while building it, and one convention was missing from the spec.

## Decision
1. **Upstream table grants (migration 112).** Closes ADR 0012's open item: every upstream `public` table (37, all
   with RLS on) gets SELECT, INSERT, UPDATE, DELETE for `authenticated` and ALL for `service_role`; nothing for `anon`.
   RLS still decides the rows. Test: `tests/db/upstream-grants.test.ts`.
2. **`move_lead(lead, stage)` (migration 113).** One transaction: the deal moves to a stage of its own pipeline (104's
   trigger writes the one history row), and the last stage is Admitted: entering it stamps `leads.admitted_at`,
   leaving it clears it. Runs as the caller (RLS applies); a viewer gets 42501, not a silent no-op. Lost and Dormant
   are a plain `leads` update, where 100's `leads_lost_has_reason` refuses Lost without a reason; the API answers 422.
3. **`days_in_stage(leads)` (migration 113)** is 104's `lead_days_in_stage` as a PostgREST computed field, so the
   board reads days in stage for every card in one query. Still computed from history, never stored.
4. **Stuck setting (assumption, until Settings in M6, #70).** An `admissions_settings` row with `kind = 'alert'`, a
   key starting `stuck` and `value = {"stage": "<stage name>", "threshold": <days>}`. A lead is stuck when its days in
   stage are more than the threshold; a stage without such a row never shows stuck.
5. **Lead panel** is wacrm's right-side `Sheet` (a full-height sheet on a phone), not the platform's `?open=` panel.
   The ported pieces (StatusChip, KindTile, KeyValue, Stepper, Timeline) live in `src/admissions/components/parts.tsx`,
   styled with token utilities because `blocks.css` was not in `src/` yet. Admissions words are English in code, not
   in `messages/`: the product is English-only and the four-locale parity test would need translations nobody reads.

## Consequences
- Lost and Dormant leads are hidden behind "Show closed" and can't be dragged. Reopening a closed lead isn't built.
- When Settings (M6) lands, it writes stuck rows in the shape of decision 4, or changes `stuckAfterByStage`.
