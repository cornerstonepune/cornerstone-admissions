# Setting up Cal.com for campus visits

Cal.com is where parents pick a visit time. When they book, Cal.com tells our app, and the app moves the family's card
to **Visit booked** and sends the WhatsApp messages. About 20 minutes.

## 1. Account and calendar
1. Sign up at cal.com with the admissions Google account (free plan).
2. Settings → Calendars → connect **Google Calendar**. Bookings then land in that calendar, and busy times are blocked.
3. Settings → Availability: set the visit days and hours.

## 2. One event type per campus
1. Event Types → New: "Neev campus visit", 45 minutes, location "In person", the campus address.
2. Open it → Advanced (or Booking questions) → add a **Phone number** question, required. Leave its identifier as
   `attendeePhoneNumber`. This is how the app recognises the parent if they book without our link.
3. Repeat for "Gurukul campus visit".
4. Copy each event's link (for example `https://cal.com/cornerstone/neev-visit`) into the app:
   Admissions Settings → Campuses → that campus → **Visit link**. The app adds the parent's name and phone to it.

## 3. Connect Cal.com to the app (the webhook)
1. Make a secret: any long random text, at least 32 characters (a password manager's generator is fine).
2. Cal.com → Settings → Developer → Webhooks → New.
   - **Subscriber URL:** `https://<our app address>/api/admissions/calcom`
   - **Secret:** the secret from step 1.
   - **Events:** tick only **Booking Created**, **Booking Rescheduled**, **Booking Cancelled**, **Booking No-show Updated**.
3. Give the same secret to whoever runs the app, to put in its settings as `CALCOM_WEBHOOK_SECRET`.
   Until it is set, the app refuses every Cal.com message. That is on purpose.
4. Use the webhook's **Ping test**. A green tick means the app is reachable. (Until the app is online, at M7, this works
   only while the local tunnel from the WhatsApp setup is running.)

## 4. WhatsApp templates to submit to Meta (no variables)
- `visit_confirmed`: sent on booking. Put the campus map link in the text.
- `visit_rsvp_24h`: sent 24 hours before. Add two quick-reply buttons: "Yes, coming" and "Need to change".
- `visit_reminder_morning`: sent at 8 am on the visit day.
- `visit_missed_rebook`: sent when a visit is marked no-show.

## 5. Day to day
- A parent who hasn't answered the 24-hour message by 6 pm the evening before shows up on the Today list to call.
- No-show: in Cal.com → Bookings → Past, mark the parent as no-show. The app sends the rebook message and adds a call.
- A cancel moves the card back to the stage it was in before.
