# 0040 — Meetings on a Calendar: Cal.com, the website and calls staff log

**Date:** 2026-11-27 · **Status:** accepted (Nimish asked for it; answers below are his)

## Context
Nimish wants every meeting with a family on one Calendar screen: campus visits, video calls and phone calls, whether a
family booked on the website or staff agreed a time on a call. Until now a visit row came only from Cal.com, recorded no
kind, and a booking from a family who had never enquired was dropped (ADR 0030 §3: "we do not create a lead from a
booking"). The website's booking page (read once, read-only, with Nimish's leave on 2026-11-27, an exception to the
isolation rule like ADR 0003) is the school's Cal.com embedded: a "school-visit" event (in person) and an
"online-meeting" event (video). Its older own-form route (Sanity) is not on the page.

## Decision
- **A visit row is any meeting** (migration 128): `kind` campus | virtual | phone (default campus), `meeting_url` (video
  only, https, at most 500 characters, checked in the database), `created_by` (null when Cal.com made it), and
  `cal_booking_id` may be null (a meeting staff add). No new table: reminders, Today, the Dashboard and the lead's
  current visit already read visits. The `lead_current_visit` view is unchanged (a hidden test pins its columns); the
  lead API reads kind and link from the row.
- **Staff book a meeting while logging a call** ("Meeting set on this call": date and time, kind, campus, video link).
  `book_meeting` runs as the staff member (RLS is the tenancy guard; agent or up; another account's campus refused);
  the same lead at the same moment is one meeting, so a retried save books once. The call's notes start with
  "Meeting set: <day, time> · <kind>", so the call log shows the date.
- **Same as a Cal.com booking (Nimish: same reminders):** the WhatsApp `visit_confirmed` goes out at once, the RSVP the
  day before and the morning reminder, and a lead before Visit booked moves to it, for every kind, phone calls
  included. The templates' words fit any meeting ("booking time with us", "meeting you today").
- **Cal.com sends the kind:** a video link in the booking (`metadata.videoCallUrl`, `videoCallData.url`, or an https
  location), or an `integrations:` location, makes it virtual; otherwise campus. Only an https link is stored.
- **A family new to us who books becomes a lead** (reverses ADR 0030's "no lead from a booking"): when no open lead
  matches and the booking is new and has a phone, the webhook runs the one door (`intake`) in `ADMISSIONS_ACCOUNT_ID`
  with source Website, the parent's name, and the child's name and grade from booking questions whose key or label
  says child/student/kid and grade/class; `fill: false`, so a family already with us is never changed. Then the
  booking is theirs as usual. No phone or no account set: logged and dropped, as before.
- **Calendar screen** (`/calendar`, in Daily work under Today): a month grid from tablet width, a day list on a phone,
  each meeting coloured and iconed by kind, a takeaway line (unmarked past meetings first, then the next one), counts
  per kind. Cancelled and rescheduled meetings are left out. Choosing one opens the lead panel.
- **No calendar library.** FullCalendar and react-big-calendar bring their own styles and colours, which the token rule
  forbids; a month grid on the installed date-fns is under 200 lines and uses our tokens.

## Consequences
- No new screen wireframe: Nimish's click-through replaces approval, as ADR 0037.
- Unverified until live: Cal.com's real payload for the video event (field names assumed from Cal.com's docs) and the
  school's booking-question names for child and grade; `ADMISSIONS_ACCOUNT_ID` must be set on Vercel for new families.
- Not done: marking a meeting Visited or No-show in the app (Cal.com's no-show only); editing or cancelling a meeting
  staff added (cancel it on Cal.com, or ask); showing logged conversations on the Calendar; email from the booking.

## Amendment, 2026-11-27: calls on the Calendar, and the old sheet's dated events
- The Calendar also shows call tasks: still to make on their due day, made on the day they were made (outcome and note
  on hover and in the phone list). A day cell shows three entries, meetings first, then "+N more".
- Nimish asked for the old sheet's comments (ADR 0036) to become events. A one-off load, read by hand, in one
  transaction on the hosted database, dry-run first: 31 calls made, 8 calls to make, 4 past visits (Visited) and
  2 upcoming meetings. Names stay out of this repo. Choices: times are not on the sheet, so past events are 10:00 and
  calls to make 11:00; "December first week" is 1 December; "next week" is 30 November; two obvious typos (year 2027,
  December for November) corrected; a missing day read as 26 November; an unconfirmed meeting or a "probably visiting"
  became a call to make; emails and messages sent, and undated actions, stayed in the notes.
- No messages: the two upcoming meetings have their reminder stamps set, so no WhatsApp reminder and no "not
  confirmed" task is made for them.
- Call notes from the load start with "Old sheet:" and have no author.
