// The Admissions pipeline (M3, #66, ADR 0024). The database does the work: move_lead (113) moves a lead and its trigger
// (104) writes the stage history; days_in_stage (113) is computed from that history; leads_lost_has_reason (100)
// refuses Lost without a lost reason. This file only calls them and turns their error codes into HTTP statuses.
import type { SupabaseClient } from "@supabase/supabase-js";
import { isUuid } from "@/lib/api/v1/pagination";
import { isEmail, phoneDigits } from "./intake";
import { isDate } from "./settings";

export type LeadExit = "lost" | "dormant";

/** The outcomes a call log can record (S-lead, Calls tab). */
export const CALL_OUTCOMES = ["Talked", "No answer", "Call back later", "Wrong number"] as const;

/** A lead as a board card shows it (embedded in its deal as `lead`). */
export interface LeadSummary {
  id: string;
  child_name: string | null;
  grade: string | null;
  exit: LeadExit | null;
  admitted_at: string | null;
  days_in_stage: number | null;
  created_at: string;
  exited_at: string | null;
  campus: { label: string; sort_order: number } | null;
  source: { label: string } | null;
}

/** The PostgREST select for a deal's lead; `days_in_stage` is the computed field from migration 113. */
export const LEAD_SUMMARY_SELECT =
  "lead:leads(id, child_name, grade, exit, admitted_at, days_in_stage, created_at, exited_at, " +
  "campus:admissions_settings!leads_campus_id_fkey(label, sort_order), source:admissions_settings!leads_source_id_fkey(label))";

/** A "stuck" alert setting: `kind = 'alert'`, key starting `stuck`, value `{ stage: <stage id>, threshold: <days> }` (ADR 0025). */
export interface AlertSetting {
  key: string;
  value: { stage?: unknown; threshold?: unknown };
}

/** Days after which a lead in each stage is stuck, by stage id. A stage without a stuck alert has no entry. */
export function stuckAfterByStage(
  stages: readonly { id: string; name: string }[],
  alerts: readonly AlertSetting[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of alerts) {
    if (!a.key.startsWith("stuck") || typeof a.value.threshold !== "number") continue;
    // Settings (ADR 0025) writes the stage's id, which survives a rename; a name is still read for older rows.
    const stage = stages.find((s) => s.id === a.value.stage) ?? stages.find((s) => s.name === a.value.stage);
    if (stage) out[stage.id] = a.value.threshold;
  }
  return out;
}

/** Stuck = longer in its stage than the days set for that stage (GLOSSARY). */
export function isStuck(days: number | null, stuckAfter: number | undefined): boolean {
  return days != null && stuckAfter != null && days > stuckAfter;
}

export type Result = { ok: true } | { ok: false; status: number; error: string };

/** Postgres error → HTTP status: a broken rule is 422, a clash 409, not allowed 403. */
export function statusOf(code: string | undefined): number {
  if (code === "23514") return 422;
  if (code === "23505") return 409;
  if (code === "42501") return 403;
  return 500;
}

function fail(error: { code?: string; message: string }): Result {
  return { ok: false, status: statusOf(error.code), error: error.message };
}

/** Moves a lead to a stage of its own pipeline (the last stage admits it). One history row per real move. */
export async function moveLead(supabase: SupabaseClient, leadId: string, stageId: string): Promise<Result> {
  const { error } = await supabase.rpc("move_lead", { p_lead_id: leadId, p_stage_id: stageId });
  return error ? fail(error) : { ok: true };
}

/** Closes an open lead as Lost (needs a lost reason; the database refuses one without) or Dormant. */
export async function closeLead(
  supabase: SupabaseClient,
  leadId: string,
  exit: LeadExit,
  lostReasonId: string | null,
): Promise<Result> {
  const { data, error } = await supabase
    .from("leads")
    .update({
      exit,
      exited_at: new Date().toISOString(),
      lost_reason_id: exit === "lost" ? lostReasonId : null,
    })
    .eq("id", leadId)
    .is("exit", null)
    .is("admitted_at", null)
    .select("id");
  if (error) return fail(error);
  if (!data?.length) return { ok: false, status: 404, error: "No open lead with this id" };
  return { ok: true };
}

/** Deletes a lead by deleting its deal (ADR 0038): the lead, its stage history, calls, follow-ups and visits cascade;
 * the parent's contact and WhatsApp conversation stay. RLS (migration 124) lets only an admin delete a lead's deal. */
export async function deleteLead(supabase: SupabaseClient, leadId: string): Promise<Result> {
  const { data: lead, error } = await supabase.from("leads").select("deal_id").eq("id", leadId).maybeSingle();
  if (error) return fail(error);
  if (!lead) return { ok: false, status: 404, error: "Lead not found" };
  const { data, error: delError } = await supabase.from("deals").delete().eq("id", lead.deal_id).select("id");
  if (delError) return fail(delError);
  if (!data?.length) return { ok: false, status: 403, error: "Only an admin can delete a lead" };
  return { ok: true };
}

/** The lead panel's editable details (Edit mode), split by the table each one lives in. */
export interface LeadEdit {
  lead: Partial<Record<"child_name" | "child_dob" | "grade" | "campus_id" | "area" | "source_id", string | null>>;
  deal: Partial<Record<"notes", string | null>>;
  contact: Partial<Record<"name" | "phone" | "email", string | null>>;
}

const TEXT_FIELDS: Record<string, { to: keyof LeadEdit; column: string; max: number; label: string }> = {
  child_name: { to: "lead", column: "child_name", max: 80, label: "The child's name" },
  grade: { to: "lead", column: "grade", max: 40, label: "The grade" },
  area: { to: "lead", column: "area", max: 120, label: "The area" },
  notes: { to: "deal", column: "notes", max: 2000, label: "Notes" },
  parent_name: { to: "contact", column: "name", max: 80, label: "The parent's name" },
};

/** Checks a PATCH's `fields` and splits them by table. Only the fields sent change; "" clears one (not the phone). */
export function parseLeadFields(raw: unknown): { ok: true; edit: LeadEdit } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "Send the details to change" };
  const edit: LeadEdit = { lead: {}, deal: {}, contact: {} };
  for (const [key, value] of Object.entries(raw)) {
    if (value !== null && typeof value !== "string") return { ok: false, error: `${key} must be text` };
    const v = value?.trim() || null;
    const text = TEXT_FIELDS[key];
    if (text) {
      if (v && v.length > text.max) return { ok: false, error: `${text.label} can be at most ${text.max} characters` };
      (edit[text.to] as Record<string, string | null>)[text.column] = v;
    } else if (key === "child_dob") {
      if (v && (!isDate(v) || v > new Date().toISOString().slice(0, 10)))
        return { ok: false, error: "Enter a real date of birth" };
      edit.lead.child_dob = v;
    } else if (key === "campus_id" || key === "source_id") {
      if (v && !isUuid(v)) return { ok: false, error: `Not a valid ${key === "campus_id" ? "campus" : "source"}` };
      edit.lead[key] = v;
    } else if (key === "phone") {
      const digits = phoneDigits(v);
      if (!digits) return { ok: false, error: "Enter a 10-digit mobile number" };
      edit.contact.phone = digits;
    } else if (key === "email") {
      if (v && !isEmail(v)) return { ok: false, error: "Enter a valid email address" };
      edit.contact.email = v?.toLowerCase() ?? null;
    } else return { ok: false, error: `Unknown field: ${key}` };
  }
  return { ok: true, edit };
}

/** Saves an edit. The campus and source must be this account's settings of that kind; a phone another contact of the
 * account already has is a 409 (one contact per phone, migration 022). The contact goes first, as only it can clash. */
export async function editLead(supabase: SupabaseClient, leadId: string, edit: LeadEdit): Promise<Result> {
  const { data: lead, error } = await supabase
    .from("leads")
    .select("contact_id, deal_id")
    .eq("id", leadId)
    .maybeSingle();
  if (error) return fail(error);
  if (!lead) return { ok: false, status: 404, error: "Lead not found" };

  const picked = (["campus_id", "source_id"] as const).filter((k) => edit.lead[k]);
  if (picked.length) {
    // RLS shows only the caller's account's settings, so another account's id is simply not found.
    const { data: found, error: e } = await supabase
      .from("admissions_settings")
      .select("id, kind")
      .in("id", picked.map((k) => edit.lead[k]!));
    if (e) return fail(e);
    for (const k of picked) {
      const kind = k === "campus_id" ? "campus" : "source";
      if (!found?.some((s) => s.id === edit.lead[k] && s.kind === kind))
        return { ok: false, status: 422, error: `Pick a ${kind} from the list` };
    }
  }

  const steps: [string, string, Record<string, unknown>][] = [
    ["contacts", lead.contact_id, edit.contact],
    ["leads", leadId, edit.lead],
    ["deals", lead.deal_id, edit.deal],
  ];
  for (const [table, id, row] of steps) {
    if (!Object.keys(row).length) continue;
    const { data, error: e } = await supabase.from(table).update(row).eq("id", id).select("id");
    if (e?.code === "23505")
      return { ok: false, status: 409, error: "Another family already has this phone number. Find them in Contacts." };
    if (e) return fail(e);
    if (!data?.length) return { ok: false, status: 403, error: "You can't edit this lead" };
  }
  return { ok: true };
}

/** The numbers above the board (S-board): admissions numbers, each with a yardstick to read it against. */
export interface PipelineStats {
  open: number;
  stuck: number;
  newThisWeek: number;
  newLastWeek: number;
  admittedThisMonth: number;
  admittedLastMonth: number;
  lostThisMonth: number;
  lostLastMonth: number;
}

/** Counts from the board's cards. Week = the last 7 days against the 7 before; month = this calendar month so far
 * against all of last month. */
export function pipelineStats(
  cards: readonly { stage_id: string; lead: LeadSummary }[],
  stuckAfter: Record<string, number>,
  now = new Date(),
): PipelineStats {
  const weekAgo = now.getTime() - 7 * 86_400_000;
  const twoWeeksAgo = now.getTime() - 14 * 86_400_000;
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
  const at = (iso: string | null) => (iso ? new Date(iso).getTime() : NaN);
  const s: PipelineStats = {
    open: 0,
    stuck: 0,
    newThisWeek: 0,
    newLastWeek: 0,
    admittedThisMonth: 0,
    admittedLastMonth: 0,
    lostThisMonth: 0,
    lostLastMonth: 0,
  };
  for (const { stage_id, lead } of cards) {
    const created = at(lead.created_at);
    if (created >= weekAgo) s.newThisWeek++;
    else if (created >= twoWeeksAgo) s.newLastWeek++;
    const admitted = at(lead.admitted_at);
    if (admitted >= monthStart) s.admittedThisMonth++;
    else if (admitted >= lastMonthStart) s.admittedLastMonth++;
    const lost = lead.exit === "lost" ? at(lead.exited_at) : NaN;
    if (lost >= monthStart) s.lostThisMonth++;
    else if (lost >= lastMonthStart) s.lostLastMonth++;
    if (!lead.exit && !lead.admitted_at) {
      s.open++;
      if (isStuck(lead.days_in_stage, stuckAfter[stage_id])) s.stuck++;
    }
  }
  return s;
}
