# M0 spec — the admissions data model

**Milestone:** M0 · **ADRs:** 0006, 0007, 0009, 0010, 0011 · **Written:** 2026-11-25 (Plan, unattended)

## What M0 delivers
Six tables beside upstream's 37 in `public`, the rules that keep them honest enforced by Postgres, and a test for each
rule that CI runs on a fresh local Supabase. No UI, no Cal.com or WhatsApp wiring.

Analogy: M0 builds the filing cabinet and its locks before anyone files a paper. Each drawer (table) only takes the
right paper (checks), each paper move leaves a slip (history, audit), and only staff with a key open a drawer (RLS).

## Tables (migration `100_admissions_tables.sql`, on main; full columns in `db/schema.sql`)
| Table | One row per | Key rules in the table itself |
|---|---|---|
| `admissions_settings` | campus, source, lost reason, follow-up rule, alert (`kind`) | unique (account, kind, key); `value` is a JSON object; follow-up rule needs stage, whole-number days, action; alert needs a threshold ≥ 0 |
| `leads` | lead, 1:1 with a deal (`deal_id` unique) | Lost ⇔ lost reason; exit ⇔ `exited_at`; not both exited and admitted; **one open lead per contact** (open = no exit, not admitted) |
| `visits` | Cal.com booking | `cal_booking_id` unique, so a repeated webhook can't add a row |
| `lead_stage_history` | stage a lead entered | append-only; days in stage counts from the latest row |
| `lead_activity` | follow-up send or call task (call log on the task) | one send per (lead, rule, stage entry) |
| `settings_changes` | change to a setting | written only by the audit trigger |

All six have RLS on from migration 100, with no policies (nobody but the service role reads them) until 101.
Migration 100 also extends upstream's `redeem_invitation` data check with the six tables, so redeeming an invite
can never cascade-delete an account that holds admissions data (upstream's guard test requires it).

## Behaviour, one ticket each (migration number fixed per ticket)
- **101 — RLS policies (G0.3, invariant 2).** Read: any member (`is_account_member(account_id)`). Write leads, visits,
  stage history (insert only), lead activity: `agent`+. Delete leads/visits/activity: `admin`+. Settings write:
  `admin`+. `settings_changes`: read for members, no write policies. A signed-in user without a profile, and anon,
  read zero rows from every table in `public`.
- **102 — Self sign-up off, invite path (G0.2, invariant 1).** Drop trigger `on_auth_user_created`. Replace
  `redeem_invitation` so a caller with **no** profile gets exactly one profile in the invitation's account with the
  invitation's role (name from sign-up metadata, email from `auth.users`); every existing branch stays as it is.
- **103 — Lead integrity.** A lead's campus, source and lost reason, a visit's campus and an activity's rule must be
  `admissions_settings` rows of the right kind in the same account; a lead's account and contact equal its deal's;
  changing a deal's contact carries over to its lead; a deal with a lead can't lose its contact.
- **104 — Stage history and deal status (invariant 5).** A new lead writes one history row for its deal's stage; each
  change of the deal's `stage_id` writes exactly one (no row when the stage didn't change). `deals.status` follows the
  lead: open, `won` when admitted, `lost` on either exit (with `closed_at`). `lead_days_in_stage(lead_id)` = whole days,
  India calendar, since the latest history row.
- **105 — Settings audit (invariant 7).** Every insert, update and delete on `admissions_settings` writes one
  `settings_changes` row: action, whole row before/after, `auth.uid()`, time. Runs as definer so members can't forge it.
- **106 — Current visit.** View `lead_current_visit` (`security_invoker`, so RLS applies): per lead, its latest visit by
  `created_at` (ties by id) whose status is not cancelled or rescheduled. Booked, visited and no-show visits count.

## Tests
`npm run db:reset && npm run test:db` (`vitest.db.config.ts`) runs `tests/db/` and `tests/holdout/db/` against local
Supabase on 54322. Each test runs in a transaction that rolls back (`tests/db/db.ts`). `npm test` excludes them.
CI `loop-tests` starts a fresh local Supabase and runs them (G0.6).

## Out of M0
Which pipeline stage is Admitted and which pipeline is Admissions (M3 decides, likely a settings kind; ADR needed then);
setting `admitted_at` from a stage move (M3); disabling GoTrue sign-up and wiring the join page to the new invite path
(M1, S-join); the first owner's seed script (M1); Cal.com and follow-up writers (M5, M6).
