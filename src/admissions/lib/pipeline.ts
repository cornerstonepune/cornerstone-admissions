// The Admissions pipeline (M3, #66, ADR 0024). The database does the work: move_lead (113) moves a lead and its trigger
// (104) writes the stage history; days_in_stage (113) is computed from that history; leads_lost_has_reason (100)
// refuses Lost without a lost reason. This file only calls them and turns their error codes into HTTP statuses.
import type { SupabaseClient } from "@supabase/supabase-js";

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
  campus: { label: string } | null;
  source: { label: string } | null;
}

/** The PostgREST select for a deal's lead; `days_in_stage` is the computed field from migration 113. */
export const LEAD_SUMMARY_SELECT =
  "lead:leads(id, child_name, grade, exit, admitted_at, days_in_stage, " +
  "campus:admissions_settings!leads_campus_id_fkey(label), source:admissions_settings!leads_source_id_fkey(label))";

/** A "stuck" alert setting: `kind = 'alert'`, key starting `stuck`, value `{ stage: <stage name>, threshold: <days> }`. */
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
    const stage = stages.find((s) => s.name === a.value.stage);
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
