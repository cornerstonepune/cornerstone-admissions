# 0041 — Source QR codes open our own address, which forwards to WhatsApp

**Date:** 2026-11-27 · **Status:** accepted (Nimish asked for permanent QR links)

## Context
Each source's QR code held a `wa.me` link with the WhatsApp number inside it. The school is still on Meta's test number,
so every printed code would die at the number change. The Settings screen also asked Meta for the number, so the links
vanished whenever the access token expired (it did on 26 November).

## Decision
- **A QR code holds `<our address>/q/<source tag>`.** That public route redirects (302, never cached) to `wa.me` on
  `ADMISSIONS_WHATSAPP_NUMBER` with the source's message, `(ref: <tag>)`, which the WhatsApp intake already reads.
- **The number is one environment variable**, not read from Meta or the database: no secret, token or query behind a
  public address, and it works while the token is expired. Changing the number = change the variable and redeploy.
- **No open redirect:** the destination host is fixed; only a source-shaped tag is accepted. A tag no source has opens
  WhatsApp and counts as WhatsApp, as before.
- The Settings → Sources links no longer need WhatsApp to be reachable. Their address is `NEXT_PUBLIC_SITE_URL`, or the
  address the screen is opened on.

## Consequences
- **The address printed in a QR code is permanent.** Moving to a school domain later keeps old codes working only while
  the old address still serves this app. Choose the address before printing.
- The variable and the number connected in Account settings → WhatsApp must be kept the same by whoever changes them.
- Not done: counting scans (only a sent message is counted).
