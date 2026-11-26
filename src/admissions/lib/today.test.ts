// #69 · The Today list: untouched past the Settings hours, calls due today (overdue first), visiting today, stuck past
// the stage's limit — each worst first, and "today" is the India day.
import { describe, expect, it } from "vitest";
import { buildToday, dayBounds, type CallTask, type OpenLead, type TodayInput, type VisitRow } from "./today";

const NOW = new Date("2026-11-25T06:30:00Z"); // 12:00 in India
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const STAGES = [
  { id: "s-enq", name: "Enquiry" },
  { id: "s-vis", name: "Visited" },
];
const ALERTS = [
  { key: "untouched", value: { threshold: 24 } },
  { key: "stuck_s_vis", value: { stage: "s-vis", threshold: 7 } },
];

function lead(id: string, o: Partial<OpenLead> & { inbound?: string; reply?: string } = {}): OpenLead {
  const { inbound, reply, ...rest } = o;
  return {
    id,
    child_name: id,
    grade: "Nursery",
    created_at: hoursAgo(2),
    days_in_stage: 0,
    deal: { stage_id: "s-enq" },
    contact: { name: `Parent ${id}`, conversations: [{ last_inbound_at: inbound ?? null, last_reply_at: reply ?? null }] },
    lead_stage_history: [],
    lead_activity: [],
    ...rest,
  };
}
const task = (id: string, leadId: string, o: Partial<CallTask> = {}): CallTask => ({
  id,
  lead_id: leadId,
  due_at: hoursAgo(1),
  done_at: null,
  outcome: null,
  notes: null,
  rule: null,
  lead: { child_name: leadId, grade: null },
  ...o,
});
const visit = (id: string, startsAt: string, status = "booked"): VisitRow => ({
  id,
  lead_id: id,
  starts_at: startsAt,
  status,
  campus: { label: "Neev" },
  lead: { child_name: id, grade: null },
});
const today = (o: Partial<TodayInput>) =>
  buildToday({ leads: [], tasks: [], visits: [], alerts: ALERTS, stages: STAGES, ...o }, NOW);

describe("dayBounds", () => {
  it("is the India day: 18:30 UTC to 18:30 UTC", () => {
    const { start, end } = dayBounds(NOW);
    expect(new Date(start).toISOString()).toBe("2026-11-24T18:30:00.000Z");
    expect(new Date(end).toISOString()).toBe("2026-11-25T18:30:00.000Z");
  });
});

describe("untouched", () => {
  it("lists a new lead nobody acted on past the Settings hours, longest first", () => {
    const t = today({
      leads: [
        lead("fresh", { created_at: hoursAgo(5) }),
        lead("older", { created_at: hoursAgo(26) }),
        lead("oldest", { created_at: hoursAgo(31) }),
      ],
    });
    expect(t.calls.map((c) => [c.leadId, c.why, c.hours])).toEqual([
      ["oldest", "untouched", 31],
      ["older", "untouched", 26],
    ]);
    expect(t.counts.untouched).toBe(2);
    expect(t.calls[0].reason).toBe("New lead, no action yet");
  });

  it("counts a parent's message as waiting again, until staff reply, call or move the lead", () => {
    const old = hoursAgo(100);
    const t = today({
      leads: [
        lead("wrote", { created_at: old, inbound: hoursAgo(30) }),
        lead("replied", { created_at: old, inbound: hoursAgo(30), reply: hoursAgo(29) }),
        lead("called", { created_at: old, lead_activity: [{ kind: "call_task", done_at: hoursAgo(50) }] }),
        lead("moved", { created_at: old, lead_stage_history: [{ entered_at: hoursAgo(99), moved_by: "u1" }] }),
        lead("auto", { created_at: old, lead_stage_history: [{ entered_at: old, moved_by: null }] }),
      ],
    });
    expect(t.calls.map((c) => c.leadId)).toEqual(["auto", "wrote"]);
    expect(t.calls[1].reason).toBe("Parent wrote, no reply yet");
  });

  it("does not list an old lead imported from a sheet, until the parent writes", () => {
    // import_leads runs as the staff member: the first stage entry is theirs, at the moment the lead was made.
    const at = hoursAgo(40);
    const imported = (inbound?: string) =>
      lead("imported", { created_at: at, inbound, lead_stage_history: [{ entered_at: at, moved_by: "staff" }] });
    expect(today({ leads: [imported()] }).calls).toEqual([]);
    expect(today({ leads: [imported(hoursAgo(30))] }).calls.map((c) => c.reason)).toEqual(["Parent wrote, no reply yet"]);
  });

  it("lists nobody as untouched when the alert is not set", () => {
    const t = buildToday(
      { leads: [lead("old", { created_at: hoursAgo(300) })], tasks: [], visits: [], alerts: [], stages: STAGES },
      NOW,
    );
    expect(t.untouchedHours).toBeNull();
    expect(t.calls).toEqual([]);
  });
});

describe("calls due today", () => {
  it("lists open call tasks due by tonight, overdue first, and not tomorrow's or done ones", () => {
    const t = today({
      leads: [lead("a"), lead("b"), lead("c"), lead("d")],
      tasks: [
        task("t-later", "a", { due_at: "2026-11-25T11:30:00Z" }),
        task("t-yesterday", "b", { due_at: "2026-11-24T05:00:00Z", rule: { label: "Enquiry, day 3: Create a call task" } }),
        task("t-tomorrow", "c", { due_at: "2026-11-25T19:00:00Z" }),
        task("t-done", "d", { done_at: hoursAgo(1), outcome: "Talked" }),
      ],
    });
    expect(t.calls.map((c) => [c.key, c.why])).toEqual([
      ["t-yesterday", "overdue"],
      ["t-later", "due"],
    ]);
    expect(t.calls[0].reason).toBe("Rule: Enquiry, day 3: Create a call task");
    expect(t.counts).toMatchObject({ due: 2, fromRules: 1 });
    expect(t.done.map((d) => [d.id, d.outcome])).toEqual([["t-done", "Talked"]]);
  });

  it("drops a closed lead's call task, and shows an untouched family once", () => {
    const t = today({
      leads: [lead("u", { created_at: hoursAgo(40) })],
      tasks: [task("t-closed", "gone"), task("t-u", "u")],
    });
    expect(t.calls.map((c) => c.key)).toEqual(["u-u"]);
  });
});

describe("visiting today", () => {
  it("lists today's visits by time, without cancelled, rescheduled or other days'", () => {
    const t = today({
      visits: [
        visit("late", "2026-11-25T10:30:00Z"),
        visit("early", "2026-11-25T04:30:00Z"),
        visit("cancelled", "2026-11-25T05:00:00Z", "cancelled"),
        visit("moved", "2026-11-25T05:00:00Z", "rescheduled"),
        visit("tomorrow", "2026-11-25T19:00:00Z"),
      ],
    });
    expect(t.visits.map((v) => v.id)).toEqual(["early", "late"]);
    expect(t.counts.visits).toBe(2);
  });
});

describe("stuck", () => {
  it("lists leads longer in their stage than its limit, furthest over first", () => {
    const t = today({
      leads: [
        lead("on-limit", { deal: { stage_id: "s-vis" }, days_in_stage: 7 }),
        lead("bit-over", { deal: { stage_id: "s-vis" }, days_in_stage: 9 }),
        lead("way-over", { deal: { stage_id: "s-vis" }, days_in_stage: 20 }),
        lead("no-limit", { deal: { stage_id: "s-enq" }, days_in_stage: 90 }),
      ],
    });
    expect(t.stuck.map((s) => [s.leadId, s.days, s.limit, s.stage])).toEqual([
      ["way-over", 20, 7, "Visited"],
      ["bit-over", 9, 7, "Visited"],
    ]);
  });
});
