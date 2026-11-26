// The Today list (S-today, #69, ADR 0027): who to call, who visits, who is stuck. Pure: the API route reads the rows with
// the caller's RLS client and this turns them into the four lists, worst first. "Today" is the day in India.
import { isStuck, stuckAfterByStage, type AlertSetting } from "./pipeline";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const IST = 5.5 * HOUR; // India keeps one offset all year

/** Start and end (ms) of the India calendar day `now` falls in. */
export function dayBounds(now: Date): { start: number; end: number } {
  const start = Math.floor((now.getTime() + IST) / DAY) * DAY - IST;
  return { start, end: start + DAY };
}

type Conversation = { last_inbound_at: string | null; last_reply_at: string | null };

/** An open lead, with what the untouched and stuck checks need. */
export interface OpenLead {
  id: string;
  child_name: string | null;
  grade: string | null;
  created_at: string;
  days_in_stage: number | null;
  deal: { stage_id: string } | null;
  contact: { name: string | null; conversations: Conversation[] } | null;
  lead_stage_history: { entered_at: string; moved_by: string | null }[];
  lead_activity: { kind: string; done_at: string | null }[];
}

type LeadName = { child_name: string | null; grade: string | null } | null;

export interface CallTask {
  id: string;
  lead_id: string;
  due_at: string;
  done_at: string | null;
  outcome: string | null;
  notes: string | null;
  rule: { label: string } | null;
  lead: LeadName;
}

export interface VisitRow {
  id: string;
  lead_id: string;
  starts_at: string;
  status: string;
  campus: { label: string } | null;
  lead: LeadName;
}

export interface TodayInput {
  leads: OpenLead[];
  tasks: CallTask[];
  visits: VisitRow[];
  alerts: AlertSetting[];
  stages: { id: string; name: string }[];
}

export interface CallRow {
  leadId: string;
  key: string;
  /** untouched (red), overdue (red: due before today), due (amber: due today). */
  why: "untouched" | "overdue" | "due";
  hours?: number; // untouched for this many hours
  dueAt?: string;
  family: string;
  parent: string;
  stage: string;
  reason: string;
  lastContact: string | null;
}

export interface StuckRow {
  leadId: string;
  family: string;
  stage: string;
  days: number;
  limit: number;
}

export interface DoneRow {
  id: string;
  leadId: string;
  family: string;
  outcome: string | null;
  notes: string | null;
  doneAt: string;
}

export interface Today {
  untouchedHours: number | null; // the Settings alert; null when it is not set
  calls: CallRow[];
  counts: { untouched: number; due: number; fromRules: number; visits: number; stuck: number };
  visits: VisitRow[];
  stuck: StuckRow[];
  done: DoneRow[];
}

const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : -Infinity);
const latest = (isos: (string | null | undefined)[]) => Math.max(-Infinity, ...isos.map(ms));
const iso = (t: number) => (Number.isFinite(t) ? new Date(t).toISOString() : null);

export const familyOf = (l: LeadName) => `${l?.child_name || "Child"}${l?.grade ? ` (${l.grade})` : ""}`;

export function buildToday(input: TodayInput, now: Date = new Date()): Today {
  const { start, end } = dayBounds(now);
  const t = now.getTime();
  const stageName = new Map(input.stages.map((s) => [s.id, s.name]));
  const stuckAfter = stuckAfterByStage(input.stages, input.alerts);
  const threshold = input.alerts.find((a) => a.key === "untouched")?.value.threshold;
  const untouchedHours = typeof threshold === "number" ? threshold : null;
  const open = new Map(input.leads.map((l) => [l.id, l]));

  const untouched: CallRow[] = [];
  const stuck: StuckRow[] = [];
  for (const l of input.leads) {
    const convs = l.contact?.conversations ?? [];
    const lastInbound = latest(convs.map((c) => c.last_inbound_at));
    const lastContact = Math.max(lastInbound, latest(convs.map((c) => c.last_reply_at)));
    const stage = stageName.get(l.deal?.stage_id ?? "") ?? "";

    // Untouched (GLOSSARY): the family is waiting on us (new lead, or wrote last) and nobody has acted since —
    // no stage move by a person, no call logged, no reply from staff — for longer than the Settings alert.
    const waitingSince = Math.max(ms(l.created_at), lastInbound);
    const lastAction = Math.max(
      latest(l.lead_stage_history.filter((h) => h.moved_by).map((h) => h.entered_at)),
      latest(l.lead_activity.filter((a) => a.kind === "call_task").map((a) => a.done_at)),
      latest(convs.map((c) => c.last_reply_at)),
    );
    if (untouchedHours != null && lastAction < waitingSince && t - waitingSince > untouchedHours * HOUR) {
      untouched.push({
        leadId: l.id,
        key: `u-${l.id}`,
        why: "untouched",
        hours: Math.floor((t - waitingSince) / HOUR),
        family: familyOf(l),
        parent: l.contact?.name ?? "",
        stage,
        reason: lastInbound > ms(l.created_at) ? "Parent wrote, no reply yet" : "New lead, no action yet",
        lastContact: iso(Number.isFinite(lastContact) ? lastContact : ms(l.created_at)),
      });
    }

    const limit = stuckAfter[l.deal?.stage_id ?? ""];
    if (isStuck(l.days_in_stage, limit)) {
      stuck.push({ leadId: l.id, family: familyOf(l), stage, days: l.days_in_stage!, limit });
    }
  }
  untouched.sort((a, b) => b.hours! - a.hours!);
  stuck.sort((a, b) => b.days - b.limit - (a.days - a.limit));

  // A family shows once: an untouched lead's call tasks wait behind its untouched row.
  const shown = new Set(untouched.map((r) => r.leadId));
  const due: CallRow[] = input.tasks
    .filter((c) => !c.done_at && ms(c.due_at) < end && open.has(c.lead_id) && !shown.has(c.lead_id))
    .sort((a, b) => ms(a.due_at) - ms(b.due_at))
    .map((c) => {
      const l = open.get(c.lead_id)!;
      const convs = l.contact?.conversations ?? [];
      const last = Math.max(latest(convs.map((x) => x.last_inbound_at)), latest(convs.map((x) => x.last_reply_at)));
      return {
        leadId: c.lead_id,
        key: c.id,
        why: ms(c.due_at) < start ? "overdue" : "due",
        dueAt: c.due_at,
        family: familyOf(l),
        parent: l.contact?.name ?? "",
        stage: stageName.get(l.deal?.stage_id ?? "") ?? "",
        reason: c.rule ? `Rule: ${c.rule.label}` : c.notes || "Call back",
        lastContact: iso(last),
      };
    });

  const visits = input.visits
    .filter((v) => ms(v.starts_at) >= start && ms(v.starts_at) < end && v.status !== "cancelled" && v.status !== "rescheduled")
    .sort((a, b) => ms(a.starts_at) - ms(b.starts_at));

  const done = input.tasks
    .filter((c) => c.done_at && ms(c.done_at) >= start && ms(c.done_at) < end)
    .sort((a, b) => ms(b.done_at) - ms(a.done_at))
    .map((c) => ({ id: c.id, leadId: c.lead_id, family: familyOf(c.lead), outcome: c.outcome, notes: c.notes, doneAt: c.done_at! }));

  return {
    untouchedHours,
    calls: [...untouched, ...due],
    counts: {
      untouched: untouched.length,
      due: due.length,
      fromRules: input.tasks.filter((c) => due.some((d) => d.key === c.id) && c.rule).length,
      visits: visits.length,
      stuck: stuck.length,
    },
    visits,
    stuck,
    done,
  };
}
