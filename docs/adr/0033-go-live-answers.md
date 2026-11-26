# 0033 — Go-live answers

**Date:** 2026-11-26 · **Status:** accepted (Nimish answered in chat; the welcome wording is pending his approval)

## Context
PROJECT.md §6 and the handoff listed questions only Nimish could answer before go-live: where visits happen and how
Cal.com is set up, whether a repeat family alerts the office, hosting, and the welcome wording.

## Decision
- **Visits, two campuses, one Cal.com event.** Parents book at **Gurukul** (the default location) or **Neev** (the other
  option they can pick). Cal.com sends the chosen in-person location as text (`payload.location`). Migration 122:
  `calcom_book` / `calcom_cancel` take it (`p_location DEFAULT NULL`; the 120 signatures are dropped so 5-argument calls
  stay unambiguous). The visit's campus is the account's active campus setting whose label appears in the location,
  case-insensitive, when exactly one does; otherwise the lead's campus, as before. A booking also sets the campus of a
  lead that has none. A cancel stored before its booking uses the same rule and leaves the lead alone.
  So each Cal.com location must contain its campus's label from Admissions Settings (e.g. "Gurukul campus, …").
- **A repeat family notifies the office.** When `intake_lead` writes the "enquired again" note on a family's open lead,
  every member of the account gets a `repeat_family` notification (upstream `notifications`, CHECK widened), except the
  staff member who saved it. Title "Repeat enquiry: <parent or phone>", body = the note (child, date of birth, source).
  No staff-specific routing. At most one a day per family (see Review fixes). Written by
  `notify_repeat_family` (SECURITY DEFINER: quick-add runs through RLS and `notifications` has no insert policy; a
  signed-in caller must be an agent or up in the account). A failure is a warning, never a lost enquiry. The
  Notifications page opens the family's lead panel; if the lead has closed, the WhatsApp chat.
- **Hosting:** Vercel for now (replaces "Cloudflare first, Docker fallback"). **Database:** the new hosted Supabase
  project `bfnrfpuaaifdhlundrum`, region ap-northeast-2 (ADR 0009's own project; never the shared one).
- **Welcome wording:** drafted by Claude in `messages/en.json` (`StarterFlows.admissions_welcome`), pending Nimish's
  approval. Other locales unchanged.
- **Still open:** date-of-birth cut-offs and grades per campus. Until then routing leaves the campus empty and staff pick.

## Review fixes (PR #94 review, migration 123)
- **One notification per family per day.** The welcome flow runs `intake_lead` on each answer, and the note grows
  between them, so the note's own check let two through. Now no `repeat_family` notification is made for a contact that
  had one in the last 24 hours, read or not. Later notes are still written.
- **Concurrency:** `intake_lead` locks the family's open lead (`FOR UPDATE`) before the note check.
- **No chosen text:** `notify_repeat_family(contact)` takes only the contact; its text is the note written in the same
  transaction (`created_at = now()`), so a direct API call (its own transaction, no note) sends nothing.

## Consequences
- A location that names neither campus, or both, books against the lead's campus (often none); staff fix it on the card.
- Repeat-family notifications are stored in English, like wacrm's; other locales show the stored text.
- No hosting or keys are set up by this ADR; M7 go-live still needs the migrations applied to the hosted project and
  Nimish's go.
