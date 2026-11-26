# WhatsApp on the Meta test number (M2)

Think of it like a phone line: Meta is the exchange, the tunnel is a temporary wire from the internet to your laptop, and the app is the handset. Meta only rings a public address, so the tunnel lends your laptop one.

## Before you start
- The Meta test app is open at developers.facebook.com → your app → WhatsApp → **API Setup**. Your own phone is added under "To" there (a test number only messages up to 5 verified numbers).
- In Meta → **App settings → Basic**, copy the **App Secret**. Add one line to `.env.local` (never committed): `META_APP_SECRET=<the secret>`. Without it the app refuses every message from Meta.

## (a) Start the app and the tunnel
1. In Terminal, in the repo folder: `supabase start`, then `npm run dev`. Leave it running.
2. In a second Terminal tab: `cloudflared tunnel --url http://localhost:3000` (if missing: `brew install cloudflared`).
3. It prints an address like `https://something-random.trycloudflare.com`. That is your **tunnel**. It changes every time you restart step 2, and you must then redo step (c).

## (b) Paste the WhatsApp values into the app
1. Open http://localhost:3000, sign in, go to **Settings → WhatsApp** (`/settings?tab=whatsapp`).
2. In the **API Credentials** card fill:
   - **Phone Number ID** — from Meta's API Setup page.
   - **WhatsApp Business Account ID** — same page.
   - **Permanent Access Token** — Meta Business Settings → System users → Generate token, with `whatsapp_business_messaging` and `whatsapp_business_management`. (The 24-hour token on API Setup also works for a quick try.)
   - **Webhook Verify Token** — make up any password-like phrase, e.g. `cornerstone-m2-test`. Note it down: the app stores it hidden and never shows it again.
   - **Two-step verification PIN** — leave blank. Test numbers have none.
3. Click **Save Configuration**. Saving also subscribes the app to your WhatsApp account at Meta.

## (c) Point Meta at the tunnel
1. Meta → your app → WhatsApp → **Configuration** → Webhook → Edit.
2. **Callback URL**: `<tunnel>/api/whatsapp/webhook`. Type it by hand: the **Webhook Callback URL** box on the app's settings screen shows `localhost`, which Meta cannot reach.
3. **Verify token**: exactly the phrase you typed in **Webhook Verify Token** in (b). It lives only in the app's database (that settings field); there is no env variable for it.
4. Click **Verify and save**. A green tick means Meta reached the app and the phrase matched. A failure here almost always means a typo in the phrase or a stale tunnel.
5. Under Webhook fields, click **Subscribe** next to `messages`.

## (d) Check the three goals
- **G2.1 inbound**: from your phone, WhatsApp the test number "hello". Within seconds it shows in the app's **Inbox** under your number.
- **G2.2 reply**: open that conversation, type a reply, send. It arrives on your phone. (Free-text replies only work within 24 hours of your last message.)
- **G2.3 template**: **Settings → Templates** → **Sync from Meta** pulls in `hello_world`. Back in the conversation, use **Send template**, pick `hello_world`, send. It arrives on your phone.

Tick each in PROJECT.md (M2) only after you have seen it on your phone.

## Connecting the real number later (finding)
What changes when we move from the test number to Cornerstone's real number:
- **Business verification**: Meta must verify Cornerstone as a business (documents, website, a few days) before the number can message anyone beyond the 5 test recipients and lift sending limits.
- **Display name**: the name parents see must be submitted and approved by Meta, and must match the brand.
- **Number**: the real number is added and verified by SMS/call, and cannot be active on the normal WhatsApp app at the same time. It will have a two-step PIN, which then goes in **Two-step verification PIN**.
- **Permanent hosted URL**: the tunnel dies when your laptop sleeps. The real number needs the app deployed at a fixed address (M7 hosted project, ADR 0009), with the Callback URL changed once to that address.
- **Templates**: our own admission templates need Meta approval; `hello_world` is for testing only.
- **Secrets**: the live App Secret and access token go into the hosting provider's settings, never into a file in the repo.
