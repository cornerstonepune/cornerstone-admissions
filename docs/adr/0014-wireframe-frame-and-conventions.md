# 0014 — Wireframe frame, navigation and conventions

**Date:** 2026-11-25 · **Status:** proposed (Plan, unattended; Nimish confirms when he signs off S-frame)

Assumptions made while drawing the PROJECT.md §4 wireframes, recorded because Nimish was not present:

1. **One file per screen ID.** Sign-off keys on `design/wireframes/<ID>.html`, so the combined rows of §4 get one file each: S-flows, S-automations, S-dashboard, S-notifications, S-settings-upstream (16 files in all).
2. **Generated, then frozen.** Every file is built by `design/wireframes/src/gen.py` from `src/body/<ID>.html` plus one shared frame (tokens only, in `@layer wf` beneath blocks.css's `components`). The output HTML is what Nimish signs off (by its hash). Changing `gen.py` and regenerating changes every file and voids every sign-off, so after sign-off edit only the one body you mean to change.
3. **Sidebar** (S-frame): Daily work: Today (count), Inbox, Pipeline, Parents, Notifications (count, kept in the sidebar where upstream has it); Oversight: Report, Dashboard; Set up: Admissions settings, Flows, Automations, Account settings. Hidden in v1: Broadcasts, AI Agents, signup, theme toggle and Settings › Appearance.
4. **Glossary words in the menu only.** M1 renames nav labels the glossary forbids (Contacts → Parents, Pipelines → Pipeline). Inside built screens the upstream wording stays until a milestone changes that screen (the board card becomes a lead in M3: S-lead).
5. **Quick-add** = three typed fields (parent phone, parent name, child name) plus a pre-set Walk-in | Phone call choice that sets the source. Staff (role agent) see only quick-add: no sidebar.
6. **Admissions settings › People** shows the upstream Team members list (same API), not a second member store.
7. **Stuck is amber, Untouched is red** (DESIGN.md §3: red only for overdue work); Lost and Dormant are grey filters, not lanes.
8. **No real names** (DESIGN.md §6): sample members are "Meera S." (admin) and "Ravi K." (staff); notes say "admissions head", not a person's name.
