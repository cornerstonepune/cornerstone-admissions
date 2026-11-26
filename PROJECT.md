# PROJECT: Cornerstone Admissions

_The locked blueprint. Agents read §1–4 and the current milestone every session. Only Plan sessions edit this file, and every edit gets an ADR in `docs/adr/`. Tasks live in GitHub Issues, not here. Folded from `ADMISSIONS_PROJECT.md` v2.1 (now history) and the code at `dcc5d5d` by loop-adopt (ADR 0004)._

**Status:** Building M1 · **Current milestone:** M1 · **Locked on:** 2026-11-25 · **Version:** v1

## 1. Product
- **Problem:** Admissions enquiries arrive by WhatsApp, website, walk-in and referral call, live in groups, personal phones and a sheet, and parents get lost between enquiry and admission.
- **Users:** Lakshmi ma'am (runs her whole day from it: who to call, who is visiting, who is stuck); Akanksha (visits, oversight); Nimish. All three have full access to start (Nimish owner, the other two admin; ADR 0006). Staff (kakas, didis) only use quick-add.
- **Must do (v1):**
  - Every enquiry becomes one lead within a minute, with its source; one lead per phone number.
  - Six stages (Enquiry, Visit booked, Visited, Deciding, Applied, Admitted) and two exits (Lost with a reason, Dormant), with stage history.
  - WhatsApp inbox and welcome flow on Meta Cloud API; Cal.com visit booking moves the lead.
  - Follow-ups send on their own until the parent replies, says yes or no, or goes quiet for 90 days.
  - Today list, staff quick-add, Settings screen (every number and message is a setting), funnel report.
- **Will NOT do (v1):** AI replies (hidden), broadcasts UI (hidden, not deleted), seats per grade, meeting recordings or voice notes, handoff to the platform or Creo, dark mode, any link to other Cornerstone systems.
- **Done for v1 means:** live on the real admissions number, old sheet imported, and no lead lives in a WhatsApp group, a personal phone or a sheet.

## 2. Architecture
- **Stack:** fork of `ArnasDon/wacrm` (MIT, ADR 0001): Next.js 16 App Router + React 19 (what wacrm is), Supabase Postgres + RLS + Auth (wacrm's data layer; its own Supabase project: local until M7, then a new hosted project, ADR 0009), Meta WhatsApp Cloud API (direct, no provider), Cal.com hosted (free booking), next-intl, Vitest. Hosting: Vercel for now, database the hosted Supabase project `bfnrfpuaaifdhlundrum` (ADR 0033).
- **Shape:** one Next.js monolith. Upstream modules stay where they are (`src/lib/{whatsapp,automations,flows,pipelines,…}`); our code lives in `src/admissions/`, our migrations in `supabase/migrations/` numbered from 100. Upstream files are touched as little as possible.
- **External systems:** Meta Cloud API (inbound webhook, signed, fails closed; outbound send per message), Cal.com webhook (booking, reschedule, cancel, no-show), a scheduler calling `/api/automations/cron` and `/api/flows/cron` every minute with `x-cron-secret`.
- **Tenancy / security:** one account (Cornerstone admissions). Access = a `profiles` row for the user with `account_id` and `account_role` (owner > admin > agent > viewer), checked by `is_account_member()` in RLS on every table (ADR 0006). Nimish = owner; Akanksha and Lakshmi ma'am = admin; staff = agent, quick-add only (assumption). No self sign-up; people join by invitation.
- **Non-negotiables:** admissions has its own Supabase project and never touches the shared project `ruznbyngtfjsaymuylhm` (ADR 0009); upstream tables stay in `public` untouched, ours sit beside them; local Supabase only until M7, never `supabase db push`; self sign-up off (invite only); isolation from every other Cornerstone repo (brief §4, ADR 0003); every Settings change logged with who and when.

## 3. Data model
- **Source of truth:** `db/schema.sql`, generated from the migrations (ADR 0005). Don't copy columns here. Today it is upstream's 37 tables in `public`; M0 adds our 6 beside them (ADR 0009, ADR 0010).
- **Entities that exist (upstream, all with RLS on, verified 2026-11-25):**

| Table | Holds | Key relations | Rough rows | Notes |
|---|---|---|---|---|
| accounts | the one workspace | owner → auth.users | 1 | one per owner |
| profiles | a member: name, role in the account | user → auth.users, → accounts | <10 | is the membership (ADR 0006) |
| account_invitations | invite links by token hash | → accounts | <20 | |
| contacts | a parent's WhatsApp identity | → accounts | ~2k/yr | unique (account, normalized phone) |
| conversations, messages, message_reactions, pending_message_statuses | WhatsApp threads | → contacts | 50k/yr | one conversation per contact |
| pipelines, pipeline_stages, deals | board, its columns, cards | deal → stage, contact, conversation | ~2k/yr | `deals.status` open/won/lost |
| automations, automation_steps, automation_pending_executions, automation_logs | rule engine and its queue | → accounts | small / growing | engine drained by cron |
| flows, flow_nodes, flow_runs, flow_run_events | chatbot flows | run → contact | small | one active run per contact |
| message_templates, quick_replies | WhatsApp templates, canned replies | → accounts | <100 | unique (account, name, language) |
| tags, contact_tags, custom_fields, contact_custom_values, contact_notes | contact extras | → contacts | small | |
| whatsapp_config, webhook_endpoints, api_keys, notifications, member_presence | integration and plumbing | → accounts | small | token encrypted |
| broadcasts, broadcast_recipients | bulk sends | | 0 | hidden in v1 |
| ai_configs, ai_knowledge_documents, ai_knowledge_chunks, ai_usage_log | AI replies | | 0 | hidden in v1 |

- **Entities M0 adds (6, in `public`; spec `docs/spec/m0-data-model.md`, ADR 0010, ADR 0011):** `leads` (1:1 with a deal in the Admissions pipeline: child name, date of birth, grade, campus, area, source, exit, lost reason; ADR 0007), `visits` (every Cal.com booking, reschedule, cancel and no-show for a lead, Cal.com booking id unique; the lead's current visit is derived from it), `lead_stage_history`, `admissions_settings` (one row per campus, source, lost reason, follow-up rule or alert, by `kind`), `lead_activity` (follow-up sends, call tasks and their call log), `settings_changes` (audit).
- **Core flow:** a message, form or quick-add finds-or-creates the contact by phone → one open lead (deal + `leads` row) in Enquiry → each stage move writes one history row → rules read settings and queue sends or call tasks → a parent reply pauses them → Admitted, Lost (with reason) or Dormant closes the lead.
- **Invariants (each becomes a test in M0):**
  1. Self sign-up is off: a sign-up without an invitation creates no account and no profile.
  2. RLS is on for every table in `public`; a signed-in user with no profile in the account reads zero rows from every table.
  3. One contact per normalized phone per account; at most one open lead per contact.
  4. A lead cannot exit as Lost without a lost reason.
  5. Every stage change writes exactly one `lead_stage_history` row; days in stage is computed from it.
  6. At most one `lead_activity` row per (lead, follow-up rule, stage entry), of the kind the rule makes, its rule and stage entry fixed (ADR 0016, ADR 0017); a repeated Cal.com webhook changes nothing (booking id unique on `visits`).
  7. Every insert, update or delete on `admissions_settings` writes a `settings_changes` row with who and when.

## 4. Frontend (screens and flows locked here; pixels locked by approved wireframes)
- **Design system (ADR 0003):** root `DESIGN.md` is the design authority, its values in `design/tokens.css` (the Cornerstone platform's tokens, copied once on 2026-11-25). `design/platform/` is a frozen reference snapshot: port from it through tickets, never import it, never edit it, never open the platform repo again. Project brand overrides only in `design/brand.css`, only for `.loop.json → brand_overridable`. Components are ported inside the screen ticket that first needs them, only as far as that screen uses them (ADR 0021); there are no separate port tickets. Inventory: `docs/design/platform-components.md`.
- **Light mode only** (ADR 0008, confirmed by Nimish 2026-11-25): `data-scheme="light"` on `<html>`, no theme picker; dark values stay in the tokens file.
- **Screens** (built = upstream wacrm, restyled by the theme in M1, not redesigned):

| ID | Screen | Who | Job | Wireframe | State |
|---|---|---|---|---|---|
| S-login | Sign in, forgot/reset password | all | get in | `design/wireframes/S-login.html` | built |
| S-join | Accept invitation | new member | join the account | `design/wireframes/S-join.html` | built |
| S-inbox | Inbox | Lakshmi ma'am | read and answer parents | `design/wireframes/S-inbox.html` | built |
| S-contacts | Contacts | Lakshmi ma'am | find a parent | `design/wireframes/S-contacts.html` | built |
| S-board | Pipeline board | Lakshmi ma'am, Akanksha | move leads between stages | `design/wireframes/S-board.html` | built; card changes in M3 |
| S-flows, S-automations | Flow and automation editors | Nimish | edit welcome flow, rules | `S-flows.html`, `S-automations.html` | built |
| S-dashboard, S-notifications, S-settings-upstream | Admissions dashboard (ADR 0037; WhatsApp overview below it), notifications, account settings | admin, leadership | this week at a glance | `S-dashboard.html`, `S-notifications.html`, `S-settings-upstream.html` | built; dashboard rebuilt (ADR 0037) |
| S-frame | Cornerstone frame: sidebar, top bar, theme | all | the restyle | `design/wireframes/S-frame.html` | new, M1 |
| S-lead | Lead card and its right-side panel | Lakshmi ma'am | child details, stage history, calls | `design/wireframes/S-lead.html` | new, M3 |
| S-quick-add | Staff quick-add (3 fields, phone) | staff | log a walk-in in 30 s | `design/wireframes/S-quick-add.html` | new, M4 |
| S-today | Today list | Lakshmi ma'am | who to call, who visits, who is stuck | `design/wireframes/S-today.html` | new, M6 |
| S-admissions-settings | Admissions Settings (8 tabs, brief §7) | Nimish, Akanksha, Lakshmi ma'am | change rules without a developer | `design/wireframes/S-admissions-settings.html` | new, M6 |
| S-report | Funnel report | Nimish, Akanksha | funnel by stage and source, days per stage, lost reasons | `design/wireframes/S-report.html` | new, M7; charts, grade, campus, trend (ADR 0037) |

  Hidden in v1: signup, broadcasts, agents (AI). The built screens get static snapshots in `design/wireframes/` (one file per ID, ADR 0014) and one `loop approve --all` from Nimish; until then they're not changed.
- **Key flows:** (1) Parent says "Hi" or scans a QR → welcome menu (call back, visit, online meeting) → child's name and date of birth → a call on S-today, or that campus's (or the online) Cal.com link → S-board shows Visit booked (ADR 0035). (2) Staff quick-add on a phone → lead in Enquiry with source. (3) Lakshmi ma'am opens S-today → calls → logs on S-lead → moves stage. (4) Admin changes a day count on S-admissions-settings → next scheduler run uses it.
- **Gate:** no frontend code for a screen until Nimish runs `loop approve <ID>`. Editing a wireframe voids its approval.

## 5. Milestones
_M0 is the data model. Every later milestone is a vertical slice Nimish can click through with `npm run local`. Goals are yes/no; each maps to a test. Order and renumbering vs. brief §9: ADR 0004. **One build ticket per milestone (two in M6), reusing wacrm first (ADR 0021).**_

**M-done** (before the loop, 2026-11-25):
- Fork in the private repo, upstream remote fetch-only, loop harness, CI (`loop-guard`, `loop-tests`, upstream `CI`, `Migrations`) — PR #6, ADR 0001.
- Design copied once from the platform — PR #19, ADR 0003.
- Upstream test suite passes: 160 files, 1728 tests (`npm test`, 2026-11-25). Typecheck 0 errors; lint 0 errors, 40 upstream warnings.
- All 60 upstream migrations replay on a fresh Postgres 17; upstream `supabase/ci/verify-schema.sql` passes; RLS on all 37 tables (verified 2026-11-25).
- **Unverified:** the app running against local Supabase and a user signing in (local default ports are taken by another project on this Mac; see §6).

**Gaps found:** `on_auth_user_created` trigger present and creates a new account for every sign-up; self sign-up page live; no DB-level tests run in `loop-tests` (only upstream's migration replay in `Migrations`); built screens have no wireframe snapshots.

### M0 — Data model · Done (2026-11-26)
- **Delivers:** the 6 admissions tables (ADR 0010) beside upstream's in `public`, upstream migrations untouched; `db/schema.sql` regenerated; every §3 invariant has a passing test in CI.
- **Goals (yes/no):**
  - [x] G0.1 A fresh local DB (`supabase db reset`: upstream 001–060 unchanged, then ours from 100) applies with zero errors and has the 6 new tables — test: `tests/db/migrations.test.ts`
  - [x] G0.2 Self sign-up off: a sign-up without an invitation gets no account or profile; an invited user gets a profile on first sign-in — test: `tests/db/access.test.ts`
  - [x] G0.3 RLS on every table; a non-member reads zero rows everywhere — test: `tests/db/rls.test.ts`
  - [x] G0.4 Invariants 3–7 enforced by the database — tests: `tests/db/invariants-*.test.ts`, `tests/db/visits.test.ts`
  - [x] G0.5 The upstream suite still passes (clients stay on `public`, ADR 0009) — test: `npm test`
  - [x] G0.6 `loop-tests` CI starts a local Postgres and runs `tests/db/` (`npm run test:db`, ADR 0011) — test: CI run on the M0 spec PR
- **Issues:** label `M0`, all closed. Last: #56 (migration 111, ADR 0017, PR #58). `db/schema.sql` regenerated after 111; `npm run test:db` 23 files, 157 tests pass (2026-11-26).
- **Out of scope:** any UI; Cal.com and WhatsApp wiring (tables only).

_Status as of 2026-11-26 (ADR 0032). "Built" = merged with CI green; Nimish has not clicked any milestone through yet. A ticked goal names its test; nothing here was checked in a running app._

### M1 — Look and frame · Built, one goal open
- **Delivers:** every existing screen in the Cornerstone theme, light only; signup, broadcasts and AI hidden.
- **Screens:** S-frame (plus snapshots of built screens approved with `loop approve --all`).
- **Goals:** [x] G1.1 no theme picker, `<html data-scheme="light">` (code read: `src/app/layout.tsx`; the upstream picker `appearance-panel.tsx` is mounted nowhere; no test) · [x] G1.2 hidden routes return 404 and are not in the menu (`src/admissions/hidden-routes.test.ts`, `src/middleware.test.ts`) · [ ] G1.3 CI token check passes on all `src/` — **fails:** CI checks only lines a PR adds; CI's own rule over all of `src/` finds 228 raw-style lines in 71 of 161 screen files, mostly upstream screens (auth, automations, broadcasts, contacts, flows) · [x] G1.4 upstream tests pass (`npm test` in CI).
- **Depends on:** M0.
- **Issues:** all closed: #52 (hidden routes), #7 (theme), #63 (theme follow-ups), #18 (frame). PRs #60, #62, #75, #79.

### M2 — WhatsApp on the test number · Code merged, hand checks not done
- **Delivers:** tunnel, Meta test app, webhook; written finding on connecting the real number.
- **Goals:** [ ] G2.1 an inbound message appears in the inbox · [ ] G2.2 a reply is delivered · [ ] G2.3 a template sends · [x] G2.4 an unsigned webhook POST is rejected (`src/app/api/whatsapp/webhook/route.signature.test.ts`).
- **Issue:** #65 (open until G2.1–G2.3 are checked by hand on the test number). PR #83 (signature check, setup doc).
- **Needs from Nimish:** brief §10 items 4–7 (Meta test app, a phone).

### M3 — Admissions pipeline · Built
- **Delivers:** Admissions pipeline with the six stages from settings, child fields on the card, stage history, days in stage, lost reason. Screens: S-board changes, S-lead. **Issue:** #66 (closed). PRs #80, #82.
- **Goals:** [x] G3.1 moving a card writes one history row · [x] G3.2 days in stage comes from history · [x] G3.3 Lost cannot be saved without a reason (API and UI) — tests: `tests/db/m3-pipeline.test.ts`, `src/app/api/admissions/leads/[id]/route.test.ts`, `src/admissions/components/lost-form.test.tsx`.

### M4 — Entry: one door · Built, one goal for Nimish
- **Delivers:** welcome flow, staff quick-add, website form endpoint, source tag per QR. Screen: S-quick-add. **Issue:** #67 (closed). PRs #91, #92 (ADR 0031).
- **Goals:** [x] G4.1 same phone twice gives one lead · [x] G4.2 date of birth routes correctly at the cut-off boundary — tests: `tests/db/m4-intake.test.ts`, `src/admissions/lib/intake.test.ts` · [ ] G4.3 quick-add under 30 s on a phone (timed by Nimish).
- **Needs from Nimish:** cut-off date and grades (§6), approval of the drafted welcome wording (ADR 0033), the G4.3 timing.

### M5 — Booking · Built
- **Delivers:** Cal.com webhook moves the lead; confirmation, T-24h RSVP, morning reminder, no-show. **Issue:** #68 (closed). PR #90 (ADR 0030).
- **Goals:** [x] G5.1 a booking moves the lead once even if the webhook repeats · [x] G5.2 cancel moves it back · [x] G5.3 unconfirmed leads appear on the call list — test: `tests/db/m5-booking.test.ts`.
- **Needs from Nimish:** a Cal.com account (not yet connected to a real one).

### M6 — Follow-ups, Today, Settings · Built
- **Delivers:** stage-changed trigger, rules engine on the settings tables, pause on reply, call tasks, S-today, S-admissions-settings. **Issues:** #69, #70 (closed). PRs #81, #85, #87, #89.
- **Goals:** [x] G6.1 a reply stops the next scheduled message · [x] G6.2 changing a day count in Settings changes behaviour without a restart · [x] G6.3 no message sent twice for the same rule and lead · [x] G6.4 a rule switched off sends nothing — test: `tests/db/m6-follow-ups.test.ts`.

### M7 — Report, import, hosting, go-live · Report and import built; live for testing (ADR 0034)
- **Delivers:** S-report and sheet import (**Issue:** #71, closed; PRs #86, #88); then hosting via `loop-release` (no ticket): a new hosted Supabase project for admissions (Nimish creates it) with all migrations applied, real number.
- **Goals:** [x] G7.1 imported leads dedupe by phone · [x] G7.2 report counts match the board — test: `tests/db/m7-report-import.test.ts` · [x] G7.3 the hosted project has the same tables as `db/schema.sql` (schema diff, ADR 0034) · [ ] G7.4 (anonymous key reads zero rows; signed-in non-member not yet tested) a signed-in non-member reads zero rows on live.
- **Needs from Nimish:** the real number (the hosted Supabase project exists, ADR 0033); production needs a proxy that overwrites X-Real-IP (ADR 0031).

## 6. Open questions (Plan resolves before the milestone they block)
- ~~Local Supabase ports~~ resolved (ADR 0011): the defaults are free on this Mac; `config.toml` unchanged.
- Siblings: one lead per phone number, but a parent may enquire for two children. Default: one child per lead; a sibling is a note on the card (ADR 0007). — blocks M0.
- Date-of-birth cut-off, reference date and grades per campus for 2027–28. — still open (ADR 0033); until then routing leaves the campus empty and staff pick.
- ~~Cal.com set-up~~ resolved (ADR 0033): one visit event, Gurukul by default or Neev; the location picks the visit's campus. Cal.com account and visit times still to be set up (docs/calcom-setup.md).
- ~~Repeat family~~ resolved (ADR 0033): notifies everyone in the account; no staff-specific routing.
- ~~Welcome wording~~ resolved (ADR 0033): drafted by Claude, pending Nimish's approval.
- ~~Hosting and the hosted Supabase project~~ resolved (ADR 0033): Vercel for now; project `bfnrfpuaaifdhlundrum` (ap-northeast-2).
- Brief §12 defaults stand until answered (Admitted = fee paid; Akanksha covers Today; old leads imported silently).
