// Cal.com webhook (M5, #68, ADR 0030). Public: no session, the signature is the only way in (fails closed without
// CALCOM_WEBHOOK_SECRET). Setup for Nimish: docs/calcom-setup.md.
import { NextResponse } from "next/server";
import { handleCalEvent, readCalEvent, verifyCalSignature } from "@/admissions/lib/booking";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { readCappedBody } from "@/lib/whatsapp/webhook-body";

export async function POST(request: Request) {
  // The raw bytes, as Cal.com signed them; request.json() would re-encode them.
  const raw = await readCappedBody(request);
  if (raw === null) return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  if (!verifyCalSignature(raw, request.headers.get("x-cal-signature-256"))) {
    console.warn("[calcom] rejected a webhook with a bad or missing signature");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const result = await handleCalEvent(supabaseAdmin(), readCalEvent(body));
  if (!result.ok) {
    console.error("[calcom] webhook failed:", result.error);
    return NextResponse.json({ error: "Could not record the booking" }, { status: 500 });
  }
  return NextResponse.json(result);
}
