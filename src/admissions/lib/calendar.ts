// The Calendar's arithmetic (ADR 0040): which days a month grid shows, which India-time day a meeting falls on, and
// the one line that says what to notice. date-fns is already here; no calendar library (their styles bypass tokens).
import { addDays, endOfMonth, endOfWeek, format, startOfMonth, startOfWeek } from "date-fns";

import { MEETING_KINDS, type MeetingKind } from "./meetings";

type Family = { child_name: string | null; grade: string | null; contact: { name: string | null } | null } | null;

/** One entry on the Calendar: a meeting (a visit row), or a call (a call task: still to make, or made). */
export interface Meeting {
  id: string;
  lead_id: string;
  starts_at: string;
  status: "booked" | "visited" | "no_show" | "to_call" | "called";
  kind: MeetingKind | "call";
  meeting_url: string | null;
  campus: { label: string } | null;
  lead: Family;
  note?: string | null; // a call's outcome and note
}

export interface CallTask {
  id: string;
  lead_id: string;
  due_at: string;
  done_at: string | null;
  outcome: string | null;
  notes: string | null;
  lead: Family;
}

/** A call task as a Calendar entry: on its due time while open, on the time it was made once done. */
export const callEntry = (c: CallTask): Meeting => ({
  id: c.id,
  lead_id: c.lead_id,
  starts_at: c.done_at ?? c.due_at,
  status: c.done_at ? "called" : "to_call",
  kind: "call",
  meeting_url: null,
  campus: null,
  lead: c.lead,
  note: [c.outcome, c.notes].filter(Boolean).join(" · ") || null,
});

export const labelOf = (m: Pick<Meeting, "kind" | "status">) =>
  m.kind === "call" ? (m.status === "called" ? "Call made" : "Call to make") : MEETING_KINDS[m.kind];

const ORDER = { booked: 0, visited: 0, no_show: 0, to_call: 1, called: 2 } as const;
/** Within a day: meetings, then calls to make, then calls made; each by time. */
export const inDayOrder = (a: Meeting, b: Meeting) =>
  ORDER[a.status] - ORDER[b.status] || Date.parse(a.starts_at) - Date.parse(b.starts_at);

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

/** What to notice: what was missed first (meetings nobody marked, calls overdue), then the next meeting coming up. */
export function takeaway(entries: Meeting[], now = new Date()): string {
  const past = (m: Meeting) => Date.parse(m.starts_at) < now.getTime();
  const unmarked = entries.filter((m) => m.status === "booked" && past(m)).length;
  const overdue = entries.filter((m) => m.status === "to_call" && past(m)).length;
  const next = entries
    .filter((m) => m.status === "booked" && !past(m))
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))[0];
  return [
    unmarked ? `${unmarked} past ${unmarked === 1 ? "meeting is" : "meetings are"} not marked Visited or No-show yet.` : "",
    overdue ? `${overdue} ${overdue === 1 ? "call is" : "calls are"} overdue.` : "",
    next
      ? `Next: ${familyOf(next)}, ${new Date(next.starts_at).toLocaleString("en-IN", { timeZone: IST, weekday: "short", day: "numeric", month: "short" })} at ${timeOf(next.starts_at)} · ${labelOf(next)}.`
      : "Nothing else booked this month.",
  ]
    .filter(Boolean)
    .join(" ");
}
