import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { buildToday, dayBounds, type TodayInput } from "@/admissions/lib/today";

/**
 * GET /api/admissions/today — the Today list (S-today): untouched leads and call tasks due (worst first), today's
 * visits, stuck leads, and calls logged today. Any member; RLS scopes every read to the caller's account.
 * shortcut: reads every open lead in one request (PostgREST's row cap, 1000 by default); page it past that.
 */
export async function GET() {
  try {
    const { supabase } = await requireRole("viewer");
    const now = new Date();
    const { start, end } = dayBounds(now);
    const startIso = new Date(start).toISOString();

    const [leads, tasks, visits, alerts, stages] = await Promise.all([
      supabase
        .from("leads")
        .select(
          "id, child_name, grade, created_at, days_in_stage, deal:deals(stage_id), " +
            "contact:contacts(name, conversations(last_inbound_at, last_reply_at)), " +
            "lead_stage_history(entered_at, moved_by), lead_activity(kind, done_at)",
        )
        .is("exit", null)
        .is("admitted_at", null),
      supabase
        .from("lead_activity")
        .select("id, lead_id, due_at, done_at, outcome, notes, rule:admissions_settings(label), lead:leads(child_name, grade)")
        .eq("kind", "call_task")
        .or(`done_at.is.null,done_at.gte.${startIso}`),
      supabase
        .from("visits")
        .select("id, lead_id, starts_at, status, campus:admissions_settings(label), lead:leads(child_name, grade)")
        .gte("starts_at", startIso)
        .lt("starts_at", new Date(end).toISOString()),
      supabase.from("admissions_settings").select("key, value").eq("kind", "alert").eq("active", true),
      supabase.from("pipeline_stages").select("id, name"),
    ]);
    const failed = [leads, tasks, visits, alerts, stages].find((r) => r.error);
    if (failed?.error) {
      console.error("[admissions/today] query failed:", failed.error);
      return NextResponse.json({ error: "Couldn't load today's list" }, { status: 500 });
    }

    const input = {
      leads: leads.data,
      tasks: tasks.data,
      visits: visits.data,
      alerts: alerts.data,
      stages: stages.data,
    } as unknown as TodayInput;
    return NextResponse.json(buildToday(input, now));
  } catch (err) {
    return toErrorResponse(err);
  }
}
