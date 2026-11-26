import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 45; // a month grid with its leading and trailing week

/**
 * GET /api/admissions/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD — every meeting (ADR 0040) from `from` up to, not
 * including, `to`, in India time: campus visits, video and phone calls, booked, visited or no-show. Cancelled and
 * rescheduled ones are left out (a reschedule is its own new meeting). Any member; RLS keeps it to the caller's account.
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
    const { data, error } = await supabase
      .from("visits")
      .select(
        "id, lead_id, starts_at, status, kind, meeting_url, campus:admissions_settings(label), " +
          "lead:leads(child_name, grade, contact:contacts(name))",
      )
      .gte("starts_at", new Date(start).toISOString())
      .lt("starts_at", new Date(end).toISOString())
      .not("status", "in", "(cancelled,rescheduled)")
      .order("starts_at");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ meetings: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}
