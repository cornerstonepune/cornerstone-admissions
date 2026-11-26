import { describe, expect, it } from "vitest";

import { buildReport, periodRange, type RawReport } from "./report";

const stage = (id: string, reached: number, extra: Partial<RawReport["stages"][number]> = {}) => ({
  id, name: id, reached, on_board: 0, median_days: null, open_days: [], ...extra,
});
const raw = (over: Partial<RawReport> = {}): RawReport => ({
  leads: 100, admitted: 10, lost: 30, dormant: 10, days_to_admit: 40.5,
  stages: [
    stage("Enquiry", 100, { median_days: 3, open_days: [9, 2] }),
    stage("Visit booked", 40, { median_days: 12 }),
    stage("Visited", 30),
    stage("Deciding", 25),
    stage("Applied", 15),
    stage("Admitted", 10),
  ],
  sources: [
    { label: "Instagram", leads: 50, admitted: 2 },
    { label: "Referral call", leads: 30, admitted: 6 },
    { label: null, leads: 20, admitted: 2 },
  ],
  lost_reasons: [{ label: "Distance", n: 15 }, { label: "Fees", n: 15 }],
  ...over,
});
const limits = { Enquiry: 5, "Visit booked": 7 };

describe("buildReport says what to notice", () => {
  const r = buildReport(raw(), raw({ leads: 80, admitted: 4 }), limits);

  it("marks the biggest drop and names the next one", () => {
    expect(r.worst).toBe(1);
    expect(r.funnelTake).toBe("Biggest drop: Enquiry → Visit booked (60% lost). Next: Deciding → Applied (40% lost).");
    expect(r.headline).toBe("Visit booked is the leak: 60% of leads that reach Enquiry go no further.");
    expect(r.funnel[2].lostFromPrev).toBeCloseTo(0.25);
    expect(r.funnel[0].prevReached).toBe(100);
  });

  it("puts a yardstick on every stat and counts stuck open leads", () => {
    expect(r.stats.map((s) => [s.label, s.value, s.yard])).toEqual([
      ["Admitted", "10", "10% of leads · last period 5%"],
      ["Reached Visit booked", "40%", "last period 50%"],
      ["Days to admit", "41", "median · last period 41"],
      ["Still open", "50", "1 stuck"],
    ]);
  });

  it("sorts sources best first and compares best with worst", () => {
    expect(r.sources.map((s) => s.label)).toEqual(["Referral call", "No source", "Instagram"]);
    expect(r.sourceTake).toBe("Referral call converts 5.0× better than Instagram.");
  });

  it("flags a stage over its stuck limit; Admitted has no days row", () => {
    expect(r.days.map((d) => [d.name, d.median, d.limit, d.over])).toEqual([
      ["Enquiry", 3, 5, false],
      ["Visit booked", 12, 7, true],
      ["Visited", null, null, false],
      ["Deciding", null, null, false],
      ["Applied", null, null, false],
    ]);
    expect(r.daysTake).toBe("Visit booked runs over the stuck limit.");
    expect(r.lostTake).toBe("Distance is 50% of all lost reasons.");
  });

  it("hides rates under 20 leads and says so", () => {
    const few = buildReport(raw({ leads: 12 }), raw({ leads: 5 }), limits);
    expect(few.rates).toBe(false);
    expect(few.stats[0].yard).toBe("last period: too few leads");
    expect(few.stats[1].value).toBe("—");
    expect(few.sourceTake).toMatch(/Too few leads/);
  });

  it("has a takeaway for an empty period", () => {
    const empty = raw({ leads: 0, admitted: 0, lost: 0, dormant: 0, days_to_admit: null, sources: [], lost_reasons: [],
      stages: raw().stages.map((s) => ({ ...s, reached: 0, median_days: null, open_days: [] })) });
    const e = buildReport(empty, empty, {});
    expect(e.funnelTake).toBe("No leads in this period yet.");
    expect(e.worst).toBe(-1);
    expect(e.lostTake).toBe("No lead was lost in this period.");
    expect(e.daysTake).toBe("No stage has a finished stay yet.");
  });
});

describe("periodRange", () => {
  const now = new Date("2026-11-26T10:00:00Z");
  it("compares 30 days with the 30 before", () => {
    const r = periodRange("30", now);
    expect(r.prevTo).toEqual(r.from);
    expect(r.from.getTime() - r.prevFrom.getTime()).toBe(now.getTime() - r.from.getTime());
  });
  it("compares this year with last year's same dates", () => {
    const r = periodRange("year", now);
    expect(r.from.getMonth()).toBe(0);
    expect(r.prevTo.getFullYear()).toBe(2025);
    expect(r.prevFrom.getFullYear()).toBe(2025);
  });
});
