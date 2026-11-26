import { describe, expect, it } from "vitest";

import { buildBreakdowns, buildFunnel, buildReport, change, type LeadRow, type RawReport } from "./report";

const now = new Date("2026-11-26T10:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();
const row = (o: Partial<LeadRow> = {}): LeadRow => ({ created_at: daysAgo(3), admitted_at: null, imported_at: null, grade: "Nursery", campus_id: "neev", ...o });
const campuses = [
  { id: "neev", label: "Neev" },
  { id: "gurukul", label: "Gurukul" },
];
const from = new Date(now.getTime() - 30 * 86_400_000);

describe("buildBreakdowns: grades, campuses and the trend", () => {
  const rows = [
    row({ grade: "Nursery" }),
    row({ grade: "Nursery", admitted_at: daysAgo(1) }),
    row({ grade: "Grade 2", campus_id: "gurukul", admitted_at: daysAgo(2), created_at: daysAgo(10) }),
    row({ grade: null, campus_id: null, created_at: daysAgo(20) }),
    row({ grade: "Nursery", imported_at: daysAgo(1), created_at: daysAgo(1) }), // imported: a lead, not on the trend
    row({ grade: "Jr KG", created_at: daysAgo(60), admitted_at: daysAgo(5) }), // created before, admitted in the period
  ];
  const b = buildBreakdowns(rows, campuses, "30", from, now);

  it("groups the period's leads by grade and campus, most leads first, with admitted", () => {
    expect(b.grades.groups.map((g) => [g.label, g.leads, g.admitted])).toEqual([
      ["Nursery", 3, 1],
      ["Grade 2", 1, 1],
      ["No grade", 1, 0],
    ]);
    expect(b.campuses.groups.map((g) => [g.label, g.leads, g.admitted])).toEqual([
      ["Neev", 3, 1],
      ["Gurukul", 1, 1],
      ["No campus", 1, 0],
    ]);
  });

  it("names admissions instead of rates under 20 leads", () => {
    expect(b.grades.take).toBe("Most leads: Nursery (3 of 5). Admitted: Nursery 1, Grade 2 1.");
    expect(b.grades.best).toBe("Grade 2");
  });

  it("names the best conversion once there are 20 leads", () => {
    const many = [...Array.from({ length: 18 }, () => row()), row({ grade: "Sr KG", admitted_at: daysAgo(1) }), row({ grade: "Sr KG" })];
    expect(buildBreakdowns(many, campuses, "30", from, now).grades.take).toBe("Most leads: Nursery (18 of 20). Best conversion: Sr KG (50%).");
  });

  it("puts 30 days in five 7-day weeks ending now, leaving imported leads out", () => {
    expect(b.trend).toHaveLength(5);
    expect(b.trend.map((t) => t.enquiries)).toEqual([0, 0, 1, 1, 2]); // 20, 10, 3 and 3 days ago
    expect(b.trend.map((t) => t.admitted)).toEqual([0, 0, 0, 0, 3]); // 1, 2 and 5 days ago
    expect(b.trend[0].label).toBe("27 Oct"); // the first week starts before the period: labelled from the period's start
    expect(b.trendPeak).toBe(4);
    expect(b.trendTake).toBe("Busiest week from 19 Nov: 2 new enquiries. 3 admitted in the period.");
    expect(b.trendNote).toBe("1 leads imported from the old sheet are left out: they have no real enquiry or admission date.");
  });

  it("uses months for this year, and says when nothing happened", () => {
    const y = buildBreakdowns([], campuses, "year", new Date("2026-01-01T00:00:00"), now);
    expect(y.trend.map((t) => t.label)).toEqual(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov"]);
    expect(y.trendTake).toBe("No new enquiry or admission in this period.");
    expect(y.trendPeak).toBe(-1);
    expect(y.grades.take).toBe("No leads in this period yet.");
    expect(y.trendNote).toBeNull();
  });
});

describe("buildFunnel and the Leads stat", () => {
  const stages = [
    { id: "a", name: "Enquiry", reached: 10, on_board: 0, median_days: null, open_days: [] },
    { id: "b", name: "Visit booked", reached: 4, on_board: 0, median_days: null, open_days: [] },
    { id: "c", name: "Visited", reached: 3, on_board: 0, median_days: null, open_days: [] },
  ];
  it("marks the worst step", () => {
    const f = buildFunnel(stages, 10);
    expect(f.worst).toBe(1);
    expect(f.funnel[2].lostFromPrev).toBeCloseTo(0.25);
    expect(f.funnelTake).toBe("Biggest drop: Enquiry → Visit booked (60% lost). Next: Visit booked → Visited (25% lost).");
  });

  it("compares leads with last period", () => {
    const raw = (leads: number): RawReport => ({ leads, admitted: 0, lost: 0, dormant: 0, days_to_admit: null, stages, sources: [], lost_reasons: [] });
    expect(buildReport(raw(10), raw(8), {}).leadsStat).toEqual({ label: "Leads", value: "10", yard: "last period 8 (+25%)" });
    expect(buildReport(raw(6), raw(8), {}).leadsStat.yard).toBe("last period 8 (−25%)");
    expect(change(5, 0)).toBe("");
  });
});
