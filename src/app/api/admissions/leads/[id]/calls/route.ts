import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { CALL_OUTCOMES, statusOf } from "@/admissions/lib/pipeline";

/**
 * POST /api/admissions/leads/[id]/calls — { outcome, notes? } logs a call made now, as a done call task (lead_activity).
 * RLS (107, 110) lets an agent add a call task without a rule in their own account.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const { supabase, accountId, userId } = await requireRole("agent");
    const body = (await request.json().catch(() => null)) as { outcome?: unknown; notes?: unknown } | null;
    const outcome = body?.outcome;
    if (typeof outcome !== "string" || !(CALL_OUTCOMES as readonly string[]).includes(outcome)) {
      return NextResponse.json({ error: "Pick how the call went" }, { status: 422 });
    }
    const notes = typeof body?.notes === "string" && body.notes.trim() ? body.notes.trim() : null;
    const now = new Date().toISOString();
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
