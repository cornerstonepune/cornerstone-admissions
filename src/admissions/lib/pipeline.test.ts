// Stuck (GLOSSARY): longer in its stage than the days set for that stage in Settings.
import { describe, expect, it } from "vitest";
import { isStuck, pipelineStats, statusOf, stuckAfterByStage, type LeadSummary } from "./pipeline";

const stages = [
  { id: "s1", name: "Enquiry" },
  { id: "s2", name: "Visit booked" },
];

describe("stuckAfterByStage", () => {
  it("maps each stuck alert to its stage by name and ignores other alerts", () => {
    expect(
      stuckAfterByStage(stages, [
        { key: "stuck_visit_booked", value: { stage: "Visit booked", threshold: 7 } },
        { key: "untouched", value: { threshold: 24 } },
        { key: "stuck_gone", value: { stage: "No such stage", threshold: 3 } },
      ]),
    ).toEqual({ s2: 7 });
  });
});

describe("stuckAfterByStage after a stage is renamed (#81 review)", () => {
  it("finds a stuck alert by its stage id whatever the stage is called now", () => {
    const renamed = [{ id: "s2", name: "Visit scheduled" }];
    expect(stuckAfterByStage(renamed, [{ key: "stuck_s2", value: { stage: "s2", threshold: 7 } }])).toEqual({ s2: 7 });
  });
});

describe("isStuck", () => {
  it("is stuck only past the day count", () => {
    expect(isStuck(8, 7)).toBe(true);
    expect(isStuck(7, 7)).toBe(false);
    expect(isStuck(8, undefined)).toBe(false);
    expect(isStuck(null, 7)).toBe(false);
  });
});

describe("statusOf", () => {
  it("turns a broken database rule into 422", () => {
    expect(statusOf("23514")).toBe(422);
    expect(statusOf("23505")).toBe(409);
    expect(statusOf("42501")).toBe(403);
    expect(statusOf(undefined)).toBe(500);
  });
});

describe("pipelineStats (the numbers above the board)", () => {
  const now = new Date(2026, 10, 26, 12); // 26 Nov 2026, local time
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();
  const card = (stage_id: string, l: Partial<LeadSummary>) => ({
    stage_id,
    lead: { id: "l", child_name: null, grade: null, exit: null, admitted_at: null, days_in_stage: 1, created_at: daysAgo(30), exited_at: null, campus: null, source: null, ...l },
  });

  it("counts open, stuck, new this week against last week, and admitted and lost this month against last month", () => {
    const s = pipelineStats(
      [
        card("s1", { created_at: daysAgo(1) }),
        card("s1", { created_at: daysAgo(3), days_in_stage: 9 }), // stuck: past 7 days in s1
        card("s2", { created_at: daysAgo(10), days_in_stage: 30 }), // s2 has no stuck alert
        card("s6", { admitted_at: daysAgo(2) }),
        card("s6", { admitted_at: new Date(2026, 9, 15).toISOString() }), // October
        card("s3", { exit: "lost", exited_at: daysAgo(5) }),
        card("s3", { exit: "dormant", exited_at: daysAgo(5) }), // dormant is not lost
        card("s3", { exit: "lost", exited_at: new Date(2026, 8, 30).toISOString() }), // September: neither month
      ],
      { s1: 7 },
      now,
    );
    expect(s).toEqual({
      open: 3,
      stuck: 1,
      newThisWeek: 2,
      newLastWeek: 1,
      admittedThisMonth: 1,
      admittedLastMonth: 1,
      lostThisMonth: 1,
      lostLastMonth: 0,
    });
  });
});
