import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { CALL_OUTCOMES, statusOf } from "@/admissions/lib/pipeline";
import { isUuid } from "@/lib/api/v1/pagination";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { sendTemplate } from "@/admissions/lib/booking";
import { meetingLine, parseMeeting } from "@/admissions/lib/meetings";

/**
 * POST /api/admissions/leads/[id]/calls — { outcome, notes?, meeting? } logs a call made now: it closes the lead's open
 * call tasks with this outcome, or, when none is open, adds a done call task (lead_activity).
 * meeting { starts_at, kind, campus_id?, url? } books the meeting the call agreed (ADR 0040) before the call is logged:
 * book_meeting is idempotent, so a retried save books it once. A new meeting gets the WhatsApp confirmation.
 * RLS (107, 110) lets an agent add a call task without a rule in their own account.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  // A malformed id would reach Postgres as 22P02 (a 500); refuse it here instead.
  if (!isUuid(id)) return NextResponse.json({ error: "Not a valid id" }, { status: 400 });
  try {
    const { supabase, accountId, userId } = await requireRole("agent");
    const body = (await request.json().catch(() => null)) as { outcome?: unknown; notes?: unknown; meeting?: unknown } | null;
    const outcome = body?.outcome;
    if (typeof outcome !== "string" || !(CALL_OUTCOMES as readonly string[]).includes(outcome)) {
      return NextResponse.json({ error: "Pick how the call went" }, { status: 422 });
    }
    const meeting = body?.meeting ? parseMeeting(body.meeting) : null;
    if (meeting && "error" in meeting) return NextResponse.json({ error: meeting.error }, { status: 422 });
    const typed = typeof body?.notes === "string" && body.notes.trim() ? body.notes.trim() : null;
    const notes = meeting ? [meetingLine(meeting), typed].filter(Boolean).join("\n") : typed;
    if (meeting) {
      const { data, error } = await supabase.rpc("book_meeting", {
        p_lead_id: id,
        p_starts_at: meeting.startsAt,
        p_kind: meeting.kind,
        p_campus_id: meeting.campusId,
        p_url: meeting.url,
      });
      if (error) return NextResponse.json({ error: error.message }, { status: statusOf(error.code) });
      const booked = ((data ?? []) as { created: boolean; account_id: string; contact_id: string; owner_id: string }[])[0];
      if (booked?.created) await sendTemplate(supabaseAdmin(), booked, "visit_confirmed");
    }
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
