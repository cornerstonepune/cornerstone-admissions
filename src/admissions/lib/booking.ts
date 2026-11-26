// M5 booking (#68, ADR 0030). Cal.com tells us about a visit through a signed webhook; the database does the state change
// in one transaction per event (migration 120: calcom_book, calcom_cancel, calcom_no_show), so a webhook delivered twice
// changes nothing the second time. This file checks the signature, reads Cal.com's payload, sends the WhatsApp messages
// the event calls for, and runs the visit reminders from wacrm's automations cron (claim_visit_reminders).
import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { engineSendTemplate } from "@/lib/automations/meta-send";
import { intake } from "./intake";
import { safeUrl } from "./meetings";

/**
 * Cal.com signs the raw body with the webhook's secret: `X-Cal-Signature-256: <hex HMAC-SHA256>`.
 * No `CALCOM_WEBHOOK_SECRET` set → every request is refused (fail closed). Compared in constant time.
 */
export function verifyCalSignature(rawBody: string, header: string | null): boolean {
  const secret = process.env.CALCOM_WEBHOOK_SECRET?.trim();
  if (!secret) {
    console.error("[calcom] CALCOM_WEBHOOK_SECRET is not set: refusing the webhook (docs/calcom-setup.md).");
    return false;
  }
  if (!header) return false;
  const expected = Buffer.from(crypto.createHmac("sha256", secret).update(rawBody).digest("hex"));
  const given = Buffer.from(header.trim().toLowerCase());
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

/** What one Cal.com webhook asks of us. */
export interface CalEvent {
  event: "booked" | "cancelled" | "no_show" | "ignored";
  booking: string;
  from: string | null; // a reschedule: the booking it replaces
  startsAt: string | null;
  leadId: string | null; // carried by our booking link (visitLink)
  phone: string | null;
  location: string | null; // the in-person location the parent picked: it names the campus (ADR 0033)
  kind: "campus" | "virtual"; // a video call when Cal.com made a video link (ADR 0040)
  meetingUrl: string | null;
  parent: string | null; // who booked, for a family new to us (ADR 0040)
  child: string | null;
  grade: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** A booking question's answer, found by its key or its label (the school names its own questions on Cal.com). */
function answer(responses: Obj, word: RegExp): string | null {
  for (const [key, r] of Object.entries(responses)) {
    const o = obj(r);
    if (word.test(key) || word.test(String(o.label ?? ""))) {
      const v = str(o.value);
      if (v) return v.slice(0, 80);
    }
  }
  return null;
}

/** Reads Cal.com's `{ triggerEvent, payload }`. Anything we don't act on is "ignored". */
export function readCalEvent(body: unknown): CalEvent {
  const b = obj(body);
  const p = obj(b.payload);
  const attendees = Array.isArray(p.attendees) ? p.attendees.map(obj) : [];
  const meta = obj(p.metadata);
  const lead = str(meta.lead);
  const responses = obj(p.responses);
  const location = str(p.location);
  // a location that is a link counts only when it is a video service's (an in-person location may be a map link)
  const videoLocation = /^https:\/\/([a-z0-9-]+\.)*(meet\.google\.com|zoom\.us|teams\.microsoft\.com|teams\.live\.com|cal\.com|cal\.video|whereby\.com)(\/|$)/i.test(location ?? "");
  const meetingUrl = safeUrl(meta.videoCallUrl) ?? safeUrl(obj(p.videoCallData).url) ?? (videoLocation ? safeUrl(location) : null);
  const name = obj(responses.name).value;
  const parent = str(name) ?? (str([str(obj(name).firstName), str(obj(name).lastName)].filter(Boolean).join(" ")) || str(attendees[0]?.name));
  const base = {
    booking: str(p.uid) ?? str(p.bookingUid) ?? "",
    from: str(p.rescheduleUid),
    startsAt: str(p.startTime),
    leadId: lead && UUID.test(lead) ? lead : null,
    phone: str(obj(obj(p.responses).attendeePhoneNumber).value) ?? attendees.map((a) => str(a.phoneNumber)).find(Boolean) ?? null,
    location,
    // Cal Video, Google Meet, Zoom: a link in the metadata, or an "integrations:…" location before the link is made
    kind: meetingUrl || /^integrations:/i.test(location ?? "") ? ("virtual" as const) : ("campus" as const),
    meetingUrl,
    parent: parent ? parent.slice(0, 80) : null,
    child: answer(responses, /child|student|kid/i),
    grade: answer(responses, /grade|class/i),
  };
  const ignored = { ...base, event: "ignored" as const };
  if (!base.booking) return ignored;
  switch (b.triggerEvent) {
    case "BOOKING_CREATED":
    case "BOOKING_RESCHEDULED":
      return base.startsAt && !Number.isNaN(Date.parse(base.startsAt)) ? { ...base, event: "booked" } : ignored;
    case "BOOKING_CANCELLED":
      return { ...base, event: "cancelled" };
    case "BOOKING_NO_SHOW_UPDATED":
      // the same event un-marks a no-show; only a mark changes anything
      return attendees.some((a) => a.noShow === true) ? { ...base, event: "no_show" } : ignored;
    default:
      return ignored;
  }
}

interface Recipient {
  account_id: string;
  contact_id: string;
  owner_id: string;
}

/** One template into the parent's WhatsApp conversation. A failure is logged, never thrown: the visit is recorded. */
export async function sendTemplate(db: SupabaseClient, to: Recipient, template: string): Promise<boolean> {
  try {
    const { data: conv, error } = await db
      .from("conversations")
      .select("id")
      .eq("account_id", to.account_id)
      .eq("contact_id", to.contact_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!conv) throw new Error("No WhatsApp conversation with this parent yet");
    // The approved template's own language, as follow-ups.ts does (a Marathi-only template is not en_US).
    const { data: tpls, error: tplErr } = await db
      .from("message_templates")
      .select("language")
      .eq("account_id", to.account_id)
      .eq("name", template)
      .eq("status", "APPROVED");
    if (tplErr) throw new Error(tplErr.message);
    const language = ((tpls ?? []) as { language: string | null }[])
      .map((t) => t.language ?? "")
      .filter(Boolean)
      .sort()[0];
    await engineSendTemplate({
      accountId: to.account_id,
      userId: to.owner_id,
      conversationId: conv.id as string,
      contactId: to.contact_id,
      templateName: template,
      language,
    });
    return true;
  } catch (e) {
    console.error(`[calcom] ${template} not sent:`, to.contact_id, e instanceof Error ? e.message : e);
    return false;
  }
}

export type CalResult = { ok: true; event: CalEvent["event"]; changed: boolean } | { ok: false; error: string };

/** Applies one webhook. `changed: false` = a replay, an unknown parent, or nothing to do. */
export async function handleCalEvent(db: SupabaseClient, ev: CalEvent): Promise<CalResult> {
  if (ev.event === "ignored") return { ok: true, event: ev.event, changed: false };

  if (ev.event === "cancelled") {
    // Lead and time too: a cancel that beats its booking is stored, so the late booking changes nothing.
    const { data, error } = await db.rpc("calcom_cancel", {
      p_booking: ev.booking,
      p_starts_at: ev.startsAt && !Number.isNaN(Date.parse(ev.startsAt)) ? ev.startsAt : null,
      p_lead_id: ev.leadId,
      p_phone: ev.phone,
      p_location: ev.location,
    });
    return error ? { ok: false, error: error.message } : { ok: true, event: ev.event, changed: data != null };
  }

  const book = (leadId: string | null) =>
    db.rpc("calcom_book", {
      p_booking: ev.booking,
      p_starts_at: ev.startsAt,
      p_lead_id: leadId,
      p_phone: ev.phone,
      p_from_booking: ev.from,
      p_location: ev.location,
      p_kind: ev.kind,
      p_url: ev.meetingUrl,
    });
  let { data, error } = ev.event === "booked" ? await book(ev.leadId) : await db.rpc("calcom_no_show", { p_booking: ev.booking });
  if (error) return { ok: false, error: error.message };
  let to = ((data ?? []) as Recipient[])[0];
  if (!to && ev.event === "booked") {
    // A family new to us booked from the website: they become a lead first (ADR 0040), then the booking is theirs.
    const leadId = await leadFromBooking(db, ev);
    if (leadId) {
      ({ data, error } = await book(leadId));
      if (error) return { ok: false, error: error.message };
      to = ((data ?? []) as Recipient[])[0];
    }
  }
  if (!to) {
    if (ev.event === "booked") console.warn("[calcom] booking matched no open lead, or was seen before:", ev.booking);
    return { ok: true, event: ev.event, changed: false };
  }
  await sendTemplate(db, to, ev.event === "booked" ? "visit_confirmed" : "visit_missed_rebook");
  return { ok: true, event: ev.event, changed: true };
}

/**
 * The lead for a booking no open lead matched, through the one door (intake), in the account the website feeds
 * (ADMISSIONS_ACCOUNT_ID). Null for a replay, a booking without a phone, or when the account isn't set. The booking's
 * answers are the public's: a family already with us is never changed (fill: false), as with the website form.
 */
async function leadFromBooking(db: SupabaseClient, ev: CalEvent): Promise<string | null> {
  const accountId = process.env.ADMISSIONS_ACCOUNT_ID;
  if (!accountId || !ev.phone) return null;
  const { data: seen, error } = await db.from("visits").select("id").eq("cal_booking_id", ev.booking).limit(1);
  if (error || seen?.length) return null; // a replay books nothing twice
  try {
    const r = await intake(db, accountId, {
      phone: ev.phone,
      parent: ev.parent ?? undefined,
      child: ev.child ?? undefined,
      grade: ev.grade ?? undefined,
      sources: ["website"],
      note: "Booked a meeting on Cal.com.",
      fill: false,
    });
    return r.lead_id;
  } catch (e) {
    console.error("[calcom] could not make a lead for a booking:", e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * Called by wacrm's automations cron every run: the RSVP and morning reminders due now, each sent once.
 * Never throws, so a reminder problem can't stop wacrm's own automations in the same run.
 */
export async function runVisitReminders(now: Date = new Date()): Promise<{ sent: number; failed: number; error?: string }> {
  const db = supabaseAdmin();
  let data: unknown;
  try {
    const res = await db.rpc("claim_visit_reminders", { p_now: now.toISOString() });
    if (res.error) throw new Error(res.error.message);
    data = res.data;
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error("[calcom] reminder claim failed:", error);
    return { sent: 0, failed: 0, error };
  }
  const run = { sent: 0, failed: 0 };
  // Claimed before sending, so a failed send is logged and not retried, never doubled.
  for (const r of (data ?? []) as (Recipient & { template: string })[]) {
    if (await sendTemplate(db, r, r.template)) run.sent++;
    else run.failed++;
  }
  return run;
}

/**
 * A campus's Cal.com link (Settings → Campuses → visit link) for one lead: the parent's name and phone filled in, and
 * the lead id carried to the webhook. The webhook trusts that id only when the booking's phone is that parent's.
 */
export function visitLink(campusLink: string, lead: { id: string; parentName?: string | null; phone?: string | null }): string {
  const url = new URL(campusLink);
  if (lead.parentName?.trim()) url.searchParams.set("name", lead.parentName.trim());
  const digits = lead.phone?.replace(/\D/g, "");
  if (digits) url.searchParams.set("attendeePhoneNumber", `+${digits}`);
  url.searchParams.set("metadata[lead]", lead.id);
  return url.toString();
}
