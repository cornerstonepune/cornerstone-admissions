import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { CALL_OUTCOMES, statusOf } from "@/admissions/lib/pipeline";
import { isUuid } from "@/lib/api/v1/pagination";

/**
 * POST /api/admissions/leads/[id]/calls — { outcome, notes? } logs a call made now: it closes the lead's open call
 * tasks with this outcome, or, when none is open, adds a done call task (lead_activity).
 * RLS (107, 110) lets an agent add a call task without a rule in their own account.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  // A malformed id would reach Postgres as 22P02 (a 500); refuse it here instead.
  if (!isUuid(id)) return NextResponse.json({ error: "Not a valid id" }, { status: 400 });
  try {
    const { supabase, accountId, userId } = await requireRole("agent");
    const body = (await request.json().catch(() => null)) as { outcome?: unknown; notes?: unknown } | null;
    const outcome = body?.outcome;
    if (typeof outcome !== "string" || !(CALL_OUTCOMES as readonly string[]).includes(outcome)) {
      return NextResponse.json({ error: "Pick how the call went" }, { status: 422 });
    }
    const notes = typeof body?.notes === "string" && body.notes.trim() ? body.notes.trim() : null;
    const now = new Date().toISOString();
    // A call made answers the lead's open call tasks (a rule's, a call-back request's): they close with this outcome,
    // so they leave the Today list. Only when none is open is the call logged as a new row.
    const { data: closed, error: closeErr } = await supabase
      .from("lead_activity")
      .update({ done_at: now, outcome, assigned_to: userId, ...(notes ? { notes } : {}) })
      .eq("lead_id", id)
      .eq("kind", "call_task")
      .is("done_at", null)
      .select("id");
    if (closeErr) return NextResponse.json({ error: closeErr.message }, { status: statusOf(closeErr.code) });
    if (closed?.length) return NextResponse.json({ ok: true }, { status: 201 });
    const { error } = await supabase.from("lead_activity").insert({
      account_id: accountId,
      lead_id: id,
      kind: "call_task",
      due_at: now,
      done_at: now,
      outcome,
      notes,
      created_by: userId,
      assigned_to: userId,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: statusOf(error.code) });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
