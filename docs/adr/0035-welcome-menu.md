# 0035 — Welcome menu: call back, visit, online meeting

**Date:** 2026-11-26 · **Status:** accepted (Nimish, in chat)

## Context
The original spec (ADMISSIONS_PROJECT.md v2.1) gives the parent a menu on first contact ("book a visit, call me back,
send info"). M4 built two plain questions instead (child's name, date of birth) and the live account had no flow at all.
Nimish, 2026-11-26: the first reply to anyone who messages or scans a QR is a menu (request a call back, visit the
school, online meeting); visit and online open the Cal.com slots; ask the child's name and date of birth; the call
back promises a call within 24 hours; the words warm and human ("it's a school, we aren't selling goods"). He dropped a
fourth "something else" option.

## Decision
- **Flow** (starter template `admissions_welcome`, `src/lib/flows/templates.ts`; words in `messages/*.json`): menu as
  three WhatsApp buttons (Meta allows three) → child's name → date of birth (dd/mm/yyyy) → by the tap:
  call back → "we'll call within 24 hours" and handoff (the chat shows as pending in the Inbox);
  visit → Neev or Gurukul button → that campus's Cal.com link; online → the online-meeting link.
- **A tap is kept** (engine): `vars[<node key>] = reply id`, so a later condition node and intake know the choice.
  The menu node is `menu`, its reply ids `call_back`, `visit`, `online`; the campus node is `campus`, its reply ids
  the campus settings' tags (`neev`, `gurukul`).
- **Call back = a call task** due now on the Today list, made by WhatsApp intake when `vars.menu = call_back`; one open
  call-back task per lead at a time (intake runs on every message of the chat).
- **Campus from the tap:** intake sets the lead's campus from `vars.campus` when the date of birth picks none
  (cut-offs are still open, ADR 0033).
- **Booking links recognise the family:** each run starts with `vars.contact_phone` (the contact's digits), and
  `{{vars.x|url}}` URL-encodes a value. Links carry `attendeePhoneNumber=%2B<phone>` and `child-first-name=<name>`
  (Cal.com prefills a booking question from the URL parameter with its identifier), so the booking matches the
  WhatsApp contact instead of opening a second lead.
- **QR restarts it:** a message carrying a source code (`(ref: tag)`) starts the welcome flow like a first message,
  so a family we already know who scans a QR gets the menu too. A plain later message from a known family does not.

## Consequences
- The Cal.com base (`https://cal.com/nimish-shah-zp0z89`) is in the template; a new Cal.com account means editing the
  three link messages in Flows (or the template).
- An online-meeting booking also moves the card to Visit booked (no separate stage), and the M5 visit messages
  (`visit_confirmed` with the map pin, reminders) are visit-worded: templates must suit both, or the online event gets
  its own handling later.
- The 62 families imported on 2026-11-26 have no messages yet: their first message gets the menu, which fills blanks
  on their existing lead only.
- Not done: out-of-hours reply; a "send info" brochure option; prefilling the parent's name.
