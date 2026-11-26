import { describe, expect, it } from "vitest";

import { buildDashboard, type DashInput, type DashLead } from "./dashboard";
import type { RawReport } from "./report";
import type { Today, VisitRow } from "./today";

const now = new Date("2026-11-26T10:00:00Z"); // Thursday
const ago = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
const lead = (o: Partial<DashLead> = {}): DashLead => ({ created_at: ago(30), imported_at: null, admitted_at: null, exited_at: null, campus_id: "neev", ...o });
const visit = (id: string, days: number, status: string, campus = "Neev"): VisitRow => ({
  id, lead_id: `l-${id}`, starts_at: ago(days), status, campus: { label: campus }, lead: { child_name: `Child ${id}`, grade: "Nursery" },
});
const stage = (id: string, reached: number) => ({ id, name: id, reached, on_board: 0, median_days: null, open_days: [] });
const funnel: RawReport = {
  leads: 40, admitted: 4, lost: 0, dormant: 0, days_to_admit: null, sources: [], lost_reasons: [],
  stages: [stage("Enquiry", 40), stage("Visit booked", 12), stage("Visited", 10), stage("Admitted", 4)],
};
const today = (o: Partial<Today> = {}): Today => ({
  untouchedHours: 24, calls: [], counts: { untouched: 0, due: 0, fromRules: 0, visits: 0, stuck: 0 }, visits: [], stuck: [], done: [], ...o,
});
const input = (o: Partial<DashInput> = {}): DashInput => ({
  leads: [
    lead({ created_at: ago(2) }), // new this week, open
    lead({ created_at: ago(5), campus_id: "gurukul" }), // new this week, open
    lead({ created_at: ago(9) }), // the week before, open
    lead({ created_at: ago(1), imported_at: ago(1) }), // imported: open, but not a new enquiry
    lead({ created_at: ago(40), admitted_at: ago(3) }), // admitted this month (was open a week ago)
    lead({ created_at: ago(60), admitted_at: ago(35) }), // admitted last month
    lead({ created_at: ago(50), exited_at: ago(10) }), // lost before the week: not open then or now
    lead({ created_at: ago(20), campus_id: null }), // open, no campus
  ],
  visits: [visit("a", 2, "visited"), visit("b", 3, "no_show"), visit("c", 1, "booked"), visit("d", -2, "booked", "Gurukul"), visit("e", -1, "booked"), visit("f", -3, "cancelled")],
  calls: [
    { assigned_to: "u1", done_at: ago(1) },
    { assigned_to: "u1", done_at: ago(2) },
    { assigned_to: "u1", done_at: ago(10) },
  ],
  moves: [{ moved_by: "u2", entered_at: ago(1) }],
  members: [
    { user_id: "u1", full_name: "Lakshmi" },
    { user_id: "u2", full_name: "Akanksha" },
    { user_id: "u3", full_name: "Nimish" },
  ],
  campuses: [
    { id: "neev", label: "Neev" },
    { id: "gurukul", label: "Gurukul" },
  ],
  funnel,
  today: today(),
  ...o,
});

describe("buildDashboard", () => {
  const d = buildDashboard(input(), now);

  it("puts a yardstick on every headline number", () => {
    expect(d.stats.map((s) => [s.label, s.value, s.yard])).toEqual([
      ["New enquiries, 7 days", 2, "7 days before: 1 (+100%)"],
      ["Visits next 7 days", 2, "last 7 days: 3 held"],
      ["Visited, last 7 days", 1, "1 no-show · 1 not marked"],
      ["Admitted this month", 1, "last month: 1"],
      ["Open leads", 5, "7 days ago: 3"],
      ["Stuck", 0, "of 5 open"],
    ]);
    expect(d.stats[2].tone).toBe("wait");
  });

  it("lists the coming visits soonest first, and flags past visits nobody marked", () => {
    expect(d.upcoming.map((v) => v.id)).toEqual(["e", "d"]);
    expect(d.attention).toEqual([{ key: "v-c", leadId: "l-c", family: "Child c (Nursery)", tone: "wait", words: "Visit not marked Visited or No-show" }]);
    expect(d.takeaway).toBe("1 visit from the last 7 days is not marked Visited or No-show yet.");
  });

  it("puts families waiting on a call first, then stuck leads", () => {
    const t = today({
      calls: [
        { leadId: "x", key: "u-x", why: "untouched", hours: 30, family: "Asha (Nursery)", parent: "", stage: "Enquiry", reason: "New lead, no action yet", lastContact: null },
        { leadId: "y", key: "t1", why: "due", dueAt: ago(0), family: "Ravi", parent: "", stage: "Enquiry", reason: "Call back", lastContact: null },
      ],
      stuck: [{ leadId: "z", family: "Meera", stage: "Deciding", days: 12, limit: 7 }],
    });
    const w = buildDashboard(input({ today: t }), now);
    expect(w.attention.map((a) => [a.family, a.tone, a.words])).toEqual([
      ["Asha (Nursery)", "late", "Untouched 30 h: new lead, no action yet"],
      ["Meera", "wait", "Stuck 12 days in Deciding (limit 7)"],
      ["Child c (Nursery)", "wait", "Visit not marked Visited or No-show"],
    ]);
    expect(w.takeaway).toBe("1 family is waiting on a call. Start with Asha (Nursery).");
    expect(w.stats[5]).toMatchObject({ value: 1, yard: "of 5 open · worst Meera", tone: "wait" });
  });

  it("marks the funnel's worst step from the last 90 days", () => {
    expect(d.funnel.worst).toBe(1);
    expect(d.funnel.rates).toBe(true);
    expect(d.funnel.funnelTake).toMatch(/^Biggest drop: Enquiry → Visit booked \(70% lost\)/);
  });

  it("splits by campus and says which campus leads", () => {
    expect(d.campuses).toEqual([
      { label: "Neev", fresh: 1, before: 1, open: 3, visits: 1, admitted: 1 },
      { label: "Gurukul", fresh: 1, before: 0, open: 1, visits: 1, admitted: 0 },
      { label: "No campus", fresh: 0, before: 0, open: 1, visits: 0, admitted: 0 },
    ]);
    expect(d.campusTake).toBe("Neev brought 1 of the 2 new enquiries this week; Neev holds 3 of 5 open leads.");
  });

  it("counts new enquiries per week for 12 weeks, this week last", () => {
    expect(d.weeks).toHaveLength(12);
    expect(d.weeks.at(-1)!.n).toBe(2);
    expect(d.weeks.at(-2)!.n).toBe(1);
    expect(d.peak).toBe(11);
    expect(d.trendTake).toBe("This week 2 enquiries, against 0.5 a week over the 11 weeks before.");
  });

  it("shows each counsellor's calls and moves, least first, and who logged nothing", () => {
    expect(d.team.map((m) => [m.name, m.calls, m.moves])).toEqual([
      ["Nimish", 0, 0],
      ["Akanksha", 0, 1],
      ["Lakshmi", 2, 0],
    ]);
    expect(d.teamTake).toBe("2 calls logged and 1 move made in 7 days (calls the 7 days before: 1). Nothing logged by Nimish.");
  });

  it("says all clear when nothing waits", () => {
    const calm = buildDashboard(input({ visits: [], leads: [lead({ created_at: ago(2) })] }), now);
    expect(calm.takeaway).toBe("Nothing waiting. Visit booked is the leak: 70% of leads that reach Enquiry go no further.");
    expect(calm.attention).toEqual([]);
  });
});
