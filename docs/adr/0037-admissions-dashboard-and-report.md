# 0037 — Admissions dashboard and a visual report

**Date:** 2026-11-26 · **Status:** proposed (Nimish asked: "significantly improve the Report tab and the Dashboard tab";
he approves on click-through)

## Context
`/dashboard` was upstream wacrm's WhatsApp overview, nothing about admissions. `/report` (ADR 0027) was mostly tables.
Counsellors and leadership need this week at a glance, and a monthly or termly review that says what to notice.
(0036 was already taken by the sheet import, so this is 0037.)

## Decision
- **Dashboard** = the admissions command centre (`src/admissions/components/dashboard.tsx`, logic
  `src/admissions/lib/dashboard.ts`). One line at the top says what matters most now (families waiting on a call →
  stuck leads → past visits not marked → enquiries falling → the funnel's leak). Six numbers, each with a yardstick:
  new enquiries 7 days (vs the 7 before), visits next 7 days (vs held last 7), visited last 7 days (no-shows, not
  marked), admitted this month (vs last month), open leads (vs 7 days ago), stuck (of open). Then Needs attention and
  Visits next 7 days (each family opens the lead panel), the funnel of the last 90 days with the worst step marked,
  enquiries per week for 12 weeks, the campus split, and each counsellor's calls logged and stage moves in 7 days.
  Upstream's WhatsApp overview stays, below, mounted only when opened.
- **Report** keeps period and campus filters and adds: a Leads tile vs last period; the funnel as bars with % that went
  on and the worst step marked; sources, grades and campuses as leads-and-admitted bars with best and lowest marked;
  days per stage as bars with the stuck limit as a line; lost reasons as ranked bars; a trend of new enquiries and
  admissions by week (30, 90 days) or month (this year). Every section opens with its takeaway.
- **No migration.** The dashboard reuses `admissions_report` (116) for the funnel and `/api/admissions/today` for
  untouched, overdue and stuck; the rest are small reads with the caller's RLS client. Charts are token-styled ports
  of the platform's StatTile, LevelBars and Spark ideas (`src/admissions/components/charts.tsx`).
- **Imported leads** (ADR 0036) count as leads, open leads and in the funnel, but not as *new* enquiries or as
  admissions by date (dashboard numbers, both trends): their dates are the import's, not the family's.

## Consequences
- The screens no longer match the approved wireframes `S-dashboard` and `S-report`; Nimish's click-through replaces
  that approval (wireframes not edited).
- Each read is one request, so PostgREST's 1000-row cap bounds the leads of a report period and the dashboard's
  12-week window (a `shortcut:` comment marks it). Far above today's volume (59 leads).
- A counsellor's "calls logged" counts call tasks they marked done (`assigned_to` on log); rule-made tasks done by
  someone else count for that person.
