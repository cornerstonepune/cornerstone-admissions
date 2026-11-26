import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { closeLead, deleteLead, editLead, moveLead, parseLeadFields } from "@/admissions/lib/pipeline";
import { isUuid } from "@/lib/api/v1/pagination";

// A malformed id would reach Postgres as 22P02 (a 500); refuse it here instead.
const badId = () => NextResponse.json({ error: "Not a valid id" }, { status: 400 });

/**
 * GET   /api/admissions/leads/[id] — one lead for the lead panel (S-lead): child, parent, stage, history, calls,
 *                                   follow-ups, current visit, and the account's lost reasons.
 * PATCH /api/admissions/leads/[id] — { stage_id } moves it (the last stage admits it);
 *                                   { exit: "lost", lost_reason_id } or { exit: "dormant" } closes it.
 *                                   Lost without a reason is refused by the database: 422.
 *                                   { fields: { child_name, child_dob, grade, campus_id, area, source_id, notes,
 *                                   parent_name, phone, email } } edits the details (Edit mode); a phone another
 *                                   family has is 409. Agent and up.
 * DELETE /api/admissions/leads/[id] — admin only: deletes the lead and all it carries; the parent stays (ADR 0038).
 * RLS scopes every read and write to the caller's account.
 */

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Ctx) {
  const { id } = await context.params;
  if (!isUuid(id)) return badId();
  try {
    const { supabase } = await requireRole("viewer");
    const { data: lead, error } = await supabase
      .from("leads")
      .select(
        "id, child_name, child_dob, grade, area, campus_id, source_id, exit, exited_at, admitted_at, created_at, days_in_stage, " +
          "campus:admissions_settings!leads_campus_id_fkey(label), source:admissions_settings!leads_source_id_fkey(label), " +
          "lost_reason:admissions_settings!leads_lost_reason_id_fkey(label), " +
          "deal:deals(id, stage_id, pipeline_id, notes, conversation_id, contact:contacts(name, phone, email))",
      )
      .eq("id", id)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    const deal = (lead as unknown as { deal: { pipeline_id: string } }).deal;

    const [stages, history, activity, visit, lostReasons, choices] = await Promise.all([
      supabase.from("pipeline_stages").select("id, name, position").eq("pipeline_id", deal.pipeline_id).order("position"),
      supabase
        .from("lead_stage_history")
        .select("id, stage_id, entered_at, moved_by")
        .eq("lead_id", id)
        .order("entered_at", { ascending: false }),
      supabase
        .from("lead_activity")
        .select("id, kind, due_at, done_at, outcome, notes, created_by")
        .eq("lead_id", id)
        .order("due_at", { ascending: false }),
      supabase.from("lead_current_visit").select("starts_at, status").eq("lead_id", id).maybeSingle(),
      supabase
        .from("admissions_settings")
        .select("id, label")
        .eq("kind", "lost_reason")
        .eq("active", true)
        .order("sort_order"),
      // campuses and sources Edit mode picks from
      supabase
        .from("admissions_settings")
        .select("id, kind, label")
        .in("kind", ["campus", "source"])
        .eq("active", true)
        .order("sort_order"),
    ]);
    const failed = [stages, history, activity, visit, lostReasons, choices].find((r) => r.error);
    if (failed?.error) return NextResponse.json({ error: failed.error.message }, { status: 500 });

    // moved_by / created_by point at auth.users; the names are on profiles.
    const userIds = [
      ...new Set(
        [...(history.data ?? []).map((h) => h.moved_by), ...(activity.data ?? []).map((a) => a.created_by)].filter(
          (u): u is string => !!u,
        ),
      ),
    ];
    const { data: people } = userIds.length
      ? await supabase.from("profiles").select("user_id, full_name").in("user_id", userIds)
      : { data: [] as { user_id: string; full_name: string | null }[] };
    const names = Object.fromEntries((people ?? []).map((p) => [p.user_id, p.full_name]));

    return NextResponse.json({
      lead,
      stages: stages.data,
      history: (history.data ?? []).map((h) => ({ ...h, moved_by_name: h.moved_by ? (names[h.moved_by] ?? null) : null })),
      activity: (activity.data ?? []).map((a) => ({ ...a, by_name: a.created_by ? (names[a.created_by] ?? null) : null })),
      visit: visit.data,
      lostReasons: lostReasons.data,
      campuses: (choices.data ?? []).filter((c) => c.kind === "campus"),
      sources: (choices.data ?? []).filter((c) => c.kind === "source"),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(request: Request, context: Ctx) {
  const { id } = await context.params;
  if (!isUuid(id)) return badId();
  try {
    const { supabase } = await requireRole("agent");
    const body = (await request.json().catch(() => null)) as {
      stage_id?: unknown;
      exit?: unknown;
      lost_reason_id?: unknown;
      fields?: unknown;
    } | null;
    const str = (v: unknown) => (typeof v === "string" && v ? v : null);
    if ([body?.stage_id, body?.lost_reason_id].some((v) => str(v) && !isUuid(str(v)!))) return badId();

    let result;
    if (body?.fields !== undefined) {
      const parsed = parseLeadFields(body.fields);
      if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
      result = await editLead(supabase, id, parsed.edit);
    } else if (str(body?.stage_id)) {
      result = await moveLead(supabase, id, str(body?.stage_id)!);
    } else if (body?.exit === "lost" || body?.exit === "dormant") {
      result = await closeLead(supabase, id, body.exit, str(body.lost_reason_id));
    } else {
      return NextResponse.json({ error: "Send fields, a stage_id, or an exit of lost or dormant" }, { status: 400 });
    }
    return result.ok
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ error: result.error }, { status: result.status });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(_request: Request, context: Ctx) {
  const { id } = await context.params;
  if (!isUuid(id)) return badId();
  try {
    const { supabase } = await requireRole("admin");
    const result = await deleteLead(supabase, id);
    return result.ok
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ error: result.error }, { status: result.status });
  } catch (err) {
    return toErrorResponse(err);
  }
}
