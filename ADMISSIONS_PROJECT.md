# Cornerstone Admissions — project brief (v2.1, 25 Nov 2026)

The single source document for the build. Read this first, then `DESIGN.md`, then `handoff`, then the open ticket.
Source of requirements: `ops/calls/admissions-call-2026-11-25-transcript.md` in the Cornerstone project (call between Nimish, Akanksha, Lakshmi ma'am).

Changes from v1: settings screen for templates and thresholds; build and test locally, hosting decided last; isolation rules tightened; design comes from `DESIGN.md` (the Argus design language); explicit list of what Nimish must provide.

## 1. Goal

One door for every admissions enquiry, and no parent ever lost between enquiry and admission.

Done means:
- Every enquiry (WhatsApp, website, walk-in, referral call) becomes one lead record within a minute, with its source.
- Lakshmi ma'am runs her whole day from one screen: who to call, who is visiting, who is stuck.
- Follow-ups go out on their own until the parent says yes, says no, or goes quiet for 90 days.
- No lead lives in a WhatsApp group, a personal phone or a Google Sheet.

Users: Lakshmi ma'am (daily), Akanksha (visits, oversight), Nimish (admin). Staff, kakas and didis only use the quick-add form.

## 2. Decisions locked

| # | Decision |
|---|---|
| D1 | Build on a fork of `ArnasDon/wacrm` (MIT, Next.js 16, Supabase, Meta Cloud API). Do not build inbox, pipeline board, chatbot flows or the automation engine from scratch. |
| D2 | New private repo `cornerstonepune/cornerstone-admissions`. Upstream stays as git remote `upstream` so fixes can be pulled. |
| D3 | This is a fresh, standalone product. It shares no code, repo, deploy, env file or data with the Cornerstone platform or any other product. |
| D4 | Database: all objects in a schema called `admissions`. During the build this lives in local Supabase only. At go-live the same schema is created in the `cornerstone-cloud` Supabase project (ref `ruznbyngtfjsaymuylhm`, Mumbai). |
| D5 | Build and test locally. No hosting work until M7. Hosting choice (Cloudflare first, Docker on a small server as fallback) is made then. |
| D6 | Booking through Cal.com hosted free plan, one admissions calendar, two event types (Neev visit, Gurukul visit). |
| D7 | WhatsApp direct on Meta Cloud API. Build against Meta's free test number. The real admin number is connected only at go-live. |
| D8 | Six stages: Enquiry, Visit booked, Visited, Deciding, Applied, Admitted. Two exits: Lost (reason required), Dormant. |
| D9 | Everything Lakshmi ma'am or Akanksha may want to change is a setting on a Settings screen, changeable without a developer (section 7). |
| D10 | Visual design comes from `DESIGN.md` in the repo root, copied from Argus. It is the only design authority. |

## 3. What wacrm gives us, and what we add

Verified by reading the code at upstream commit of 17 Nov 2026 (not yet run):

| Have (use as is) | Add (our work) |
|---|---|
| Shared inbox, templates, button and list messages, quick replies | Stage-changed trigger for automations (does not exist) |
| Pipeline board with drag and drop, deals linked to chats | Stage history table, days in stage, lost reason |
| Chatbot flows: menu, collect input, conditions, handoff | Child fields on the lead: child name, date of birth, grade, campus, area |
| Automations: wait, condition, send template, wait for reply | Cal.com webhook: booking, reschedule, cancel, no-show |
| Cron endpoint that drains due steps (shared-secret header) | Staff quick-add page (3 fields) |
| Signed-webhook check that fails closed, encrypted WhatsApp token, RLS on all 37 tables | Today list for Lakshmi ma'am, call log on the card |
| Theme system on CSS variables (one block per theme) | Admissions Settings screen; funnel report |

Leave out in v1: the AI reply module (needs pgvector, not needed), broadcasts UI (hide, do not delete).

## 4. Isolation rules

The product must not touch, read or depend on anything outside itself. The agent must not open, clone or reference the platform repo, the website repo or any other Cornerstone codebase.

**During the build (M0 to M6): zero contact with the live Supabase project.**
1. All database work runs on local Supabase (`supabase start`, Docker). wacrm ships a `supabase/config.toml`.
2. No live Supabase keys in this repo's env files until M7. The agent does not call the Supabase MCP against `ruznbyngtfjsaymuylhm` before M7.

**Schema rules (apply locally from M1, so go-live is a replay, not a rewrite):**
3. Every table, function, type and policy goes in `admissions`. Upstream migrations have 213 `public.` references and unqualified names. Do not hand-edit them. One script rewrites `public.` to `admissions.` and runs each file with `search_path = admissions, extensions`. Re-run it when pulling upstream.
4. No trigger on `auth.users`. Upstream installs `on_auth_user_created`; remove it. Create the admissions profile when an invited person first signs in.
5. Access is decided only by membership in `admissions.account_members`. Self sign-up off.
6. Own migration history in `admissions.schema_migrations`, applied by a small script. Never `supabase db push`.
7. All three Supabase clients (browser, server, admin) set `db: { schema: 'admissions' }`.
8. Storage buckets prefixed `admissions-`.

**At go-live (M7), the only contact points with the shared project, all known in advance:**
- A new `admissions` schema and four `admissions-` buckets.
- The shared login table `auth.users`: admissions users are added to it. Nothing is changed for existing platform users, and a platform user who is not an admissions member sees zero rows.
- One dashboard setting: add `admissions` to the exposed API schemas.
- Never touched: `public`, `pii`, `internal`, `retired`, `attic`, and the platform's migration history.
- Check before and after: platform table and row counts unchanged. (State on 25 Nov: no `admissions` schema, no trigger on `auth.users`, no buckets.)

## 5. Running locally

- App: `npm run dev` on the Mac. Database: local Supabase in Docker.
- WhatsApp needs a public address to deliver messages to the Mac. Use a free tunnel (`cloudflared tunnel` or ngrok) and point the Meta test app's webhook at it. Without a tunnel, M2 onward cannot be tested with a real phone.
- Scheduled follow-ups: a local script calls `/api/automations/cron` and `/api/flows/cron` every minute with the `x-cron-secret` header.
- Day counts must be testable in minutes: a dev-only setting that treats one "day" as one minute.
- One command, `npm run local`, starts database, app, tunnel and the scheduler. Nimish should not need more than that to test.

## 6. Parent journey

| Stage | Entered when | Automatic messages | Lakshmi ma'am's task | If the parent stalls |
|---|---|---|---|---|
| Enquiry | First message, website form or staff quick-add | Welcome and menu: book a visit, call me back, send info | Call back within 24 hours if asked | 24h nudge with booking link, day 3 call task, day 7 nudge, day 14 Dormant |
| Visit booked | Cal.com booking | Confirmation with map pin, T-24h "coming?" button, morning reminder | Call anyone unconfirmed the evening before | No-show: rebook message same day, one call |
| Visited | She marks visit done | Thank-you same day with fee sheet | Voice note or notes on the card | Day 2 "any questions?" buttons, day 7 call task |
| Deciding | Parent replies or asks for a second call | Day 15 one proof message | Second call or online meeting, log outcome | Day 30 final call, then Lost with reason or Dormant |
| Applied | Application link opened or form received | Document reminder day 3, fee reminder | Check documents, confirm seat | Call after two reminders |
| Admitted | Fee paid | Welcome and next steps | Hand over to Creo | None |

Rules that apply everywhere:
- Any reply from the parent pauses the automatic sequence and creates a task.
- Dormant leads get one last message at day 75, then close at day 90.
- "To be picked up" is not a stage. It is a red alert when a lead has no action within the set hours.
- Before the visit collect only: parent name, phone, child name, date of birth, area. Date of birth decides Neev or Gurukul.
- One lead per phone number. A second enquiry from the same number updates the existing lead.

Every number and message in this table is a default value in Settings, not code.

## 7. Settings screen (admin only: Nimish, Akanksha; Lakshmi ma'am can edit templates and rules)

| Tab | What can be changed |
|---|---|
| Follow-up rules | One row per rule: stage, days after entering the stage, action (send template, create call task, move to Dormant), which template, on or off. Add, edit, reorder, switch off. |
| Templates | List of WhatsApp templates with Meta approval status, wording, variables, preview. Create and submit to Meta from here (wacrm already does submit and sync). Pick which template each rule uses. |
| Alerts | Hours before an untouched lead turns red; days in a stage before a card is marked stuck, per stage. |
| Stages | Names, order, colour. Lost reasons list. |
| Campuses and routing | Campus names, date-of-birth cut-off and reference date, grades per campus, Cal.com link per campus. |
| Sources | QR and link per source (gate, event, Instagram, referral card), each with its tag. |
| Welcome flow | Menu wording and options, the questions asked, working hours and the out-of-hours reply. |
| People | Who has access, and their role. |

Rules: every change is logged with who and when. A change takes effect on the next scheduler run, with no deploy. Leads already waiting on a rule keep the timing they started with unless the rule is switched off.

## 8. Design

- `DESIGN.md` in the repo root (copied from Argus by Nimish) is the design authority. If anything here conflicts with it, `DESIGN.md` wins.
- wacrm styles everything through CSS variables in `src/app/globals.css`, one block per theme, dark by default. Add one theme, `cornerstone`, built from the `DESIGN.md` tokens, make it the default and make light mode the default. Remove the theme picker. This restyles all existing screens without rewriting them.
- New screens (Today, quick-add, card additions, report, Settings) follow `DESIGN.md` fully.
- Standing rules: mostly white background, cards, soft shadows, three font types, no oversized type; action first, detail one click away in a right-side panel that opens on click; tables always sortable and filterable; highlight what is off or overdue, never a flat list.
- Gate: no new screen is built until Nimish has approved its wireframe.

## 9. Milestones

Each is a vertical slice Nimish can test locally with `npm run local`. Only critical tests.

**M0 — Repo, harness, runs locally**
- Fork pushed to the private repo, loop harness installed, upstream remote set, `DESIGN.md` in place.
- Checks: stock wacrm runs locally against local Supabase; a user can sign in; upstream test suite passes.

**M1 — `admissions` schema and theme**
- Rewrite script, own migration history, no `auth.users` trigger, clients on the new schema, `cornerstone` theme as default.
- Checks: zero objects created outside `admissions` and `storage`; RLS on every table; a signed-in user who is not a member reads zero rows; upstream tests still pass.

**M2 — WhatsApp on the test number**
- Tunnel, Meta test app, webhook.
- Checks: inbound message appears in the inbox; reply is delivered; a template sends; unsigned webhook POST is rejected.
- Output: written finding on connecting the real admin number (keep the phone app working or not, provider needed or not).

**M3 — Admissions pipeline**
- Stages from settings, child fields, stage history, days in stage, lost reason required.
- Checks: moving a card writes one history row; days in stage is computed from history; Lost cannot be saved without a reason.

**M4 — Entry: one door**
- Welcome flow from "Hi" to menu to details to campus routing to Cal.com link. Staff quick-add. Website form endpoint. Source tag per QR.
- Checks: same phone twice gives one lead; date of birth routes correctly at the cut-off boundary; quick-add takes under 30 seconds on a phone.

**M5 — Booking**
- Cal.com webhook moves the card; confirmation, T-24h RSVP, morning reminder, no-show.
- Checks: a booking moves the lead once even if the webhook repeats; cancel moves it back; unconfirmed leads appear on the call list.

**M6 — Follow-ups, Today, Settings**
- Stage-changed trigger, rules engine reading the settings tables, pause on reply, call tasks, Today list, full Settings screen.
- Checks: a reply stops the next scheduled message; changing a day count in Settings changes behaviour without a restart; no message is sent twice for the same rule and lead; a rule switched off sends nothing.

**M7 — Report, import, hosting, go-live**
- Funnel by stage and source, median days per stage, lost reasons. Import live rows from the old sheet. Choose and set up hosting. Create the `admissions` schema in the live project. Connect the real number.
- Checks: imported leads dedupe by phone; report counts match the board; platform table and row counts unchanged after go-live; non-member platform user reads zero rows on live.

Later, not in this build: 60-second pre-visit questions, meeting voice note to the child card, handoff of admitted children to the platform and Creo.

## 10. Needed from Nimish

Nothing else is needed. Items are grouped by the milestone they block.

**Before M0 (to start at all)**
1. Create the empty private repo `cornerstonepune/cornerstone-admissions`.
2. Copy `DESIGN.md` from the Argus repo into it.
3. Docker Desktop running on the Mac (already installed).

**Before M2 (WhatsApp test)**
4. A Meta developer account (free, at developers.facebook.com) logged in with the Facebook login that administers the Cornerstone business.
5. In it, create one app of type Business and add the WhatsApp product. Meta gives a free test number.
6. From that app, paste into the local env file (never into chat): App ID, App Secret, Phone Number ID, WhatsApp Business Account ID, and a permanent access token from a System User.
7. Add up to five personal phone numbers as allowed test recipients (yours, Akanksha's, Lakshmi ma'am's).
8. Optional, not a blocker: check Business Verification status in Meta Business Suite, Security Centre. Unverified accounts can use the API but may start only 250 new conversations a day, far above admissions volume. Verify later if the display name is refused or volume grows.

**Before M4 (entry flow)**
9. The date-of-birth cut-off and reference date for Neev vs Gurukul, and the grades each campus takes in 2027–28.
10. Final wording of the welcome message and menu (a draft will be given to edit).

**Before M5 (booking)**
11. A Cal.com account on the admissions Google account, with that Google Calendar connected.
12. Visit days, times, length and gap for each campus.
13. A Cal.com API key and webhook secret, pasted into the local env file.

**Before M6 (follow-ups)**
14. Approval of the wireframes for Today, the parent card, quick-add, Settings and the report.
15. Edited wording for the 12 templates (drafts will be given). Akanksha and Lakshmi ma'am review.

**Before M7 (go-live)**
16. Which number is the admissions number, which phone it is on, and whether it runs the WhatsApp Business app. Final display name, logo and description set on it.
17. A payment card added on the WhatsApp Business account (only Nimish can do this).
18. Display name approved by Meta on the admissions number. Business Verification only if Meta asks for it at this step.
19. Supabase dashboard: add `admissions` to exposed API schemas.
20. Hosting account (Cloudflare) and the web address to use, for example `admissions.cornerstoneschool.in`.
21. Login emails for Lakshmi ma'am and Akanksha.
22. Edit access to the old admissions sheet.
23. Personal numbers removed from Instagram, Facebook, Google listings and school-listing sites, replaced by the one QR or link.

## 11. WhatsApp templates to draft and submit

| Name | Category (expected) | When |
|---|---|---|
| `visit_confirmed` | Utility | On booking |
| `visit_rsvp_24h` | Utility | 24 hours before |
| `visit_reminder_morning` | Utility | Morning of the visit |
| `visit_missed_rebook` | Utility | No-show |
| `walkin_missed_you` | Utility | Walk-in logged by staff |
| `enquiry_nudge_book` | Marketing | Day 1 and day 7, no booking |
| `post_visit_thanks` | Utility | Same day |
| `post_visit_questions` | Marketing | Day 2 |
| `deciding_proof` | Marketing | Day 15 |
| `dormant_last_touch` | Marketing | Day 75 |
| `application_reminder` | Utility | Day 3 after link |
| `admitted_welcome` | Utility | On fee paid |

Meta decides the final category. Replies inside 24 hours of a parent's message need no template. On the test number, only Meta's sample template can be sent until the real account's templates are approved; build with `WHATSAPP_TEMPLATES_DRY_RUN` for the rest.

## 12. Open questions, with the default the build uses until answered

| Question | Default |
|---|---|
| What counts as Admitted? | Fee paid |
| Fee sheet on WhatsApp when asked? | Yes, sent on request |
| Who covers when Lakshmi ma'am is away? | Akanksha gets the Today list |
| Seats per grade and founding-family places left | Not shown in v1 |
| Does Creo's enquiry module overlap? | Ignore; hand over only at Admitted |
| Old leads: send a "we dropped the ball" message? | No, import silently |
| Recording parent meetings | Not in v1; needs spoken consent when added |

## 13. Risks

1. Hosting is unproven until M7. wacrm is written for Node hosting; Cloudflare may need adapter work. Fallback is its own Dockerfile on a small server. Accepted, by decision D5.
2. Template and display-name approval time is outside our control. Submit templates as soon as wording is agreed. Business Verification is not required to start (250 new conversations a day unverified).
3. Keeping the phone app working on the real number may need a provider. Decide from the M2 finding.
4. Go-live touches a shared database. Section 4 limits it to a new schema, new buckets and new login rows, with counts checked before and after.
5. Fork drift from upstream. Keep our code in `src/admissions/` and our migrations numbered from 100; touch upstream files as little as possible.
6. Kakas not logging walk-ins is a people problem. The tool only makes it a 30-second job.
