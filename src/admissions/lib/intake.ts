// One door (M4, #67, ADR 0031). Every way an enquiry arrives (WhatsApp, staff quick-add, the website form) ends in
// intake(): the phone in any format becomes M7's normalised digits, the date of birth picks the campus from the campus
// settings, and intake_lead (migration 119) finds-or-creates the contact and opens or reuses its one lead in Enquiry.
import type { SupabaseClient } from "@supabase/supabase-js";

import { sheetPhone } from "./import";
import { isDate } from "./settings";

/** A phone as anyone types it (+91, spaces, 10 digits, a leading 0) → digits with the country code, or null. */
export const phoneDigits = (raw: string | null | undefined): string | null => (raw ? sheetPhone(raw) : null);

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** A date of birth as a parent types it: 2022-03-14, 14/03/2022, 14-3-2022, 14.03.2022, 14 March 2022 → YYYY-MM-DD.
 * Day first, as in India. Anything else, or a date that doesn't exist, is null. */
export function parseDob(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim().toLowerCase();
  let y: string, m: string | number, d: string;
  let x = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (x) [, y, m, d] = x;
  else if ((x = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s))) [, d, m, y] = x;
  else if ((x = /^(\d{1,2})(?:st|nd|rd|th)?[\s-]+([a-z]{3})[a-z]*,?[\s-]+(\d{4})$/.exec(s))) {
    [, d, , y] = x;
    m = MONTHS.indexOf(x[2]) + 1;
    if (!m) return null;
  } else return null;
  const iso = `${y}-${String(m).padStart(2, "0")}-${d.padStart(2, "0")}`;
  return isDate(iso) ? iso : null;
}

export interface Campus {
  id: string;
  value: { grades?: unknown; born_from?: unknown; born_before?: unknown };
}

/** The campus whose date-of-birth window holds `dob`: born on or after `born_from` and before `born_before` (the
 * cut-off), as Nimish enters them in Admissions settings. No match, or two campuses matching, routes nowhere and staff
 * pick. The grade is set only when the campus names one grade; a range ("Playgroup – Sr KG") can't be split by date. */
export function routeByDob(dob: string, campuses: Campus[]): { campus_id?: string; grade?: string } {
  const hits = campuses.filter(({ value: v }) => {
    const from = isDate(v.born_from) ? v.born_from : null;
    const before = isDate(v.born_before) ? v.born_before : null;
    return (from || before) && (!from || dob >= from) && (!before || dob < before);
  });
  if (hits.length !== 1) return {};
  const grades = typeof hits[0].value.grades === "string" ? hits[0].value.grades.trim() : "";
  const one = grades && !/[,/&–—]| - | to /i.test(grades);
  return one ? { campus_id: hits[0].id, grade: grades } : { campus_id: hits[0].id };
}

/** The message a source's WhatsApp link fills in, ending in its code (the source's tag, unique per account and never
 * changed after it is made). */
export const prefilledText = (tag: string) => `Hi! I'd like to know about admissions at Cornerstone. (ref: ${tag})`;

/** The code a first message carries, or null. */
export const sourceCode = (text: string | null | undefined): string | null =>
  /\(ref:\s*([a-z0-9_]+)\)/i.exec(text ?? "")?.[1].toLowerCase() ?? null;

/** The click-to-chat link for a source on the account's WhatsApp number. */
export const waLink = (number: string, tag: string) =>
  `https://wa.me/${number.replace(/\D/g, "")}?text=${encodeURIComponent(prefilledText(tag))}`;

/** The two ways a family reaches staff (S-quick-add), as source tags. */
export const QUICK_ADD_SOURCES = ["walk_in", "phone_call"] as const;

export interface IntakeInput {
  phone?: string | null; // any format; or
  contactId?: string; // a contact the WhatsApp webhook already found
  parent?: string;
  child?: string;
  dob?: string | null; // YYYY-MM-DD
  area?: string;
  campus?: string; // a campus setting's tag (the welcome flow's campus button); used when the date picks none
  sources: string[]; // source tags, first one that exists wins
  note?: string; // added when the family already has an open lead
  reopen?: boolean; // false: a family whose lead has closed gets no new one
  fill?: boolean; // false (the public form): a family already with us is never changed, it only gets the note
}
export interface IntakeResult {
  contact_id: string;
  lead_id: string | null;
  created: boolean;
}

export class IntakeError extends Error {}

/** The one door. `db` is the caller's client (RLS) for staff, the service client for WhatsApp and the website. */
export async function intake(db: SupabaseClient, accountId: string, input: IntakeInput): Promise<IntakeResult> {
  const phone = input.contactId ? null : phoneDigits(input.phone);
  if (!input.contactId && !phone) throw new IntakeError("Enter a 10-digit mobile number.");
  let route: { campus_id?: string; grade?: string } = {};
  if (input.dob || input.campus) {
    const { data, error } = await db
      .from("admissions_settings")
      .select("id, key, value")
      .eq("account_id", accountId)
      .eq("kind", "campus")
      .eq("active", true);
    if (error) throw error;
    const campuses = (data ?? []) as (Campus & { key: string })[];
    if (input.dob) route = routeByDob(input.dob, campuses);
    const picked = campuses.find((c) => c.key === input.campus);
    if (!route.campus_id && picked) route = { campus_id: picked.id };
  }
  const { data, error } = await db.rpc("intake_lead", {
    p_account_id: accountId,
    p_lead: {
      phone,
      contact_id: input.contactId,
      parent: input.parent,
      child: input.child,
      child_dob: input.dob || undefined,
      area: input.area,
      source_keys: input.sources,
      note: input.note,
      reopen: input.reopen ?? true,
      fill: input.fill ?? true,
      ...route,
    },
  });
  if (error) throw error;
  return data as IntakeResult;
}

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 120) : undefined);

/** The welcome menu's "Request a call back" button (its reply id; the flow keeps the tap as vars.menu). */
export const CALL_BACK = "call_back";
export const CALL_BACK_NOTE = "Asked for a call back on WhatsApp. We promised a call within 24 hours.";

/** A call task due now on the Today list, unless the family already has an open call-back task (intake runs on every
 * message of the welcome chat, so the tap is seen more than once).
 * shortcut: two messages of one chat processed at the same instant could both add it; a unique index would close that. */
async function callBack(db: SupabaseClient, accountId: string, leadId: string): Promise<void> {
  const { data, error } = await db
    .from("lead_activity")
    .select("id")
    .eq("lead_id", leadId)
    .eq("kind", "call_task")
    .eq("notes", CALL_BACK_NOTE)
    .is("done_at", null)
    .limit(1);
  if (error) throw error;
  if (data?.length) return;
  const { error: insErr } = await db
    .from("lead_activity")
    .insert({ account_id: accountId, lead_id: leadId, kind: "call_task", due_at: new Date().toISOString(), notes: CALL_BACK_NOTE });
  if (insErr) throw insErr;
}

/** WhatsApp door, called by the webhook on every new inbound message. A code from a source's QR or link sets the
 * source (an unknown code, or none, means WhatsApp); the welcome flow's answers (vars child_name, child_dob, area,
 * parent_name) fill the lead. Never throws: a failed intake must not lose the message. */
export async function intakeFromWhatsApp(
  db: SupabaseClient,
  p: { accountId: string; contactId: string; text: string; flowRunId?: string },
): Promise<void> {
  try {
    const code = sourceCode(p.text);
    let vars: Record<string, unknown> = {};
    if (p.flowRunId) {
      const { data } = await db.from("flow_runs").select("vars").eq("id", p.flowRunId).maybeSingle();
      vars = (data?.vars as Record<string, unknown>) ?? {};
    }
    const lead = await intake(db, p.accountId, {
      contactId: p.contactId,
      sources: code ? [code, "whatsapp"] : ["whatsapp"],
      reopen: code !== null, // a closed family's "thank you" is not a new enquiry; a scanned QR is
      parent: text(vars.parent_name),
      child: text(vars.child_name),
      dob: parseDob(text(vars.child_dob)),
      area: text(vars.area),
      campus: text(vars.campus),
    });
    if (vars.menu === CALL_BACK && lead?.lead_id) await callBack(db, p.accountId, lead.lead_id);
  } catch (err) {
    console.error("[admissions/intake] WhatsApp intake failed:", err instanceof Error ? err.message : err);
  }
}
