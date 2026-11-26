import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { callEntry, type CallTask } from "@/admissions/lib/calendar";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 45; // a month grid with its leading and trailing week

/**
 * GET /api/admissions/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD — every meeting (ADR 0040) from `from` up to, not
 * including, `to`, in India time: campus visits, video and phone calls, booked, visited or no-show (cancelled and
 * rescheduled ones are left out: a reschedule is its own new meeting), and call tasks: still to make on their due day,
 * made on the day they were made. Any member; RLS keeps it to the caller's account.
 * shortcut: PostgREST returns at most 1000 call rows for the range; page it if a month ever holds more.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  const start = Date.parse(`${from}T00:00:00+05:30`);
  const end = Date.parse(`${to}T00:00:00+05:30`);
  if (!DAY.test(from) || !DAY.test(to) || Number.isNaN(start) || Number.isNaN(end) || end <= start || end - start > MAX_DAYS * 86_400_000) {
    return NextResponse.json({ error: `Ask for up to ${MAX_DAYS} days, as from=YYYY-MM-DD&to=YYYY-MM-DD` }, { status: 400 });
  }
  try {
    const { supabase } = await requireRole("viewer");
    const [a, b] = [new Date(start).toISOString(), new Date(end).toISOString()];
    const family = "lead:leads(child_name, grade, contact:contacts(name))";
    const [visits, calls] = await Promise.all([
      supabase
        .from("visits")
        .select(`id, lead_id, starts_at, status, kind, meeting_url, campus:admissions_settings(label), ${family}`)
        .gte("starts_at", a)
        .lt("starts_at", b)
        .not("status", "in", "(cancelled,rescheduled)")
        .order("starts_at"),
      supabase
        .from("lead_activity")
        .select(`id, lead_id, due_at, done_at, outcome, notes, ${family}`)
        .eq("kind", "call_task")
        .or(`and(done_at.is.null,due_at.gte.${a},due_at.lt.${b}),and(done_at.gte.${a},done_at.lt.${b})`)
        .order("due_at"),
    ]);
    const error = visits.error ?? calls.error;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({
      meetings: [...(visits.data ?? []), ...((calls.data ?? []) as unknown as CallTask[]).map(callEntry)],
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
