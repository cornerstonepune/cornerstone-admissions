// Stuck (GLOSSARY): longer in its stage than the days set for that stage in Settings.
import { describe, expect, it } from "vitest";
import { isStuck, statusOf, stuckAfterByStage } from "./pipeline";

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
