# WhatsApp message templates to submit (drafts for Nimish's approval)

WhatsApp only lets a business start a conversation, or write more than 24 hours after the parent's last message, with
a template Meta has approved. Submit these from **Account settings → Templates** once the number is connected. Language:
English. No variables (the app sends them as they are). Names must match exactly: the app looks them up by name.

Words: warm, plain, from people at a school, never salesy. At most one emoji.

## Sent by the app on Cal.com bookings (names fixed in `src/admissions/lib/booking.ts`)
These go out for school visits and online meetings alike, so they don't name a campus or a place. The time, place or
Zoom link is in Cal.com's confirmation email.

| Name | Category | Text | Buttons |
|---|---|---|---|
| `visit_confirmed` | Utility | Thank you for booking time with us at Cornerstone School. We're looking forward to meeting you and your child. The time and details are in your confirmation email; if anything changes, just reply here. | — |
| `visit_rsvp_24h` | Utility | Hello from Cornerstone School. We're looking forward to seeing you tomorrow. Will the time still work for you? | Yes, coming · Need to change |
| `visit_reminder_morning` | Utility | Good morning from Cornerstone School 🙏 Just a gentle reminder that we're meeting you today. If you need directions or anything else, reply here and we'll help. | — |
| `visit_missed_rebook` | Utility | We missed you today, and we hope all is well. Whenever it suits you, reply here and we'll find another time together. | — |

## For follow-up rules (Admissions settings → Rules), once approved
Switch a rule on only after its template is approved: a rule that fires before approval marks that family "Not sent"
for the stage and never retries.

| Name | Rule | Category | Text | Buttons |
|---|---|---|---|---|
| `enquiry_nudge_1` | Enquiry, day 1 | Marketing | Hello again from Cornerstone School. Whenever you're ready, we'd love to show you around or talk on a call. Just reply here and tell us what suits you. | — |
| `enquiry_nudge_7` | Enquiry, day 7 | Marketing | We hope the school search is going well. If you'd like to see Cornerstone in person or have any questions, we're here; just reply. | — |
| `visited_thank_you` | Visited, day 0 | Utility | Thank you for spending time with us today. It was lovely to meet you. If any questions come up as you think things over, reply here and we'll answer. | — |
| `visited_any_questions` | Visited, day 2 | Marketing | Hello from Cornerstone School. Is there anything we can help you with as you decide? We're happy to talk it through; just reply here. | — |
| `deciding_check_in` | Deciding, day 15 | Marketing | Hello from Cornerstone School. We know choosing a school is a big decision. If a second visit or a conversation with our teachers would help, just let us know. | — |

Meta decides the category; nudges usually count as Marketing (higher cost, and parents can opt out). Any reply from
the parent pauses the follow-ups (G6.1) and shows in the Inbox.
