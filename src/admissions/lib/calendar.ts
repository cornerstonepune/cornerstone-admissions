// The Calendar's arithmetic (ADR 0040): which days a month grid shows, which India-time day a meeting falls on, and
// the one line that says what to notice. date-fns is already here; no calendar library (their styles bypass tokens).
import { addDays, endOfMonth, endOfWeek, format, startOfMonth, startOfWeek } from "date-fns";

import { MEETING_KINDS, type MeetingKind } from "./meetings";

export interface Meeting {
  id: string;
  lead_id: string;
  starts_at: string;
  status: "booked" | "visited" | "no_show";
  kind: MeetingKind;
  meeting_url: string | null;
  campus: { label: string } | null;
  lead: { child_name: string | null; grade: string | null; contact: { name: string | null } | null } | null;
}

const IST = "Asia/Kolkata";

/** The India-time calendar day a moment falls on, as YYYY-MM-DD. */
export const dayKey = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: IST });

/** "11:00 am" in India time. */
export const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-IN", { timeZone: IST, hour: "numeric", minute: "2-digit" });

/** The weeks (Monday first) that cover a month, each seven YYYY-MM-DD days, and the range to ask the server for. */
export function monthGrid(month: Date): { weeks: string[][]; from: string; to: string } {
  const first = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
  const last = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
  const weeks: string[][] = [];
  for (let d = first; d <= last; d = addDays(d, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => format(addDays(d, i), "yyyy-MM-dd")));
  }
  return { weeks, from: weeks[0][0], to: format(addDays(last, 1), "yyyy-MM-dd") };
}

/** Who the meeting is with: the child (grade), else the parent. */
export const familyOf = (m: Meeting) =>
  m.lead?.child_name
    ? `${m.lead.child_name}${m.lead.grade ? ` (${m.lead.grade})` : ""}`
    : (m.lead?.contact?.name ?? "A family");

/** What to notice: past meetings nobody marked first (they spoil the visit numbers), then the next one coming up. */
export function takeaway(meetings: Meeting[], now = new Date()): string {
  const unmarked = meetings.filter((m) => m.status === "booked" && Date.parse(m.starts_at) < now.getTime()).length;
  const next = meetings.find((m) => m.status === "booked" && Date.parse(m.starts_at) >= now.getTime());
  const nextLine = next
    ? `Next: ${familyOf(next)}, ${new Date(next.starts_at).toLocaleString("en-IN", { timeZone: IST, weekday: "short", day: "numeric", month: "short" })} at ${timeOf(next.starts_at)} · ${MEETING_KINDS[next.kind]}.`
    : "Nothing else booked this month.";
  return unmarked ? `${unmarked} past ${unmarked === 1 ? "meeting is" : "meetings are"} not marked Visited or No-show yet. ${nextLine}` : nextLine;
}
