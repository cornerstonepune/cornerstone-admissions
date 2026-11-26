import { describe, expect, it } from "vitest";

import { callEntry, dayKey, inDayOrder, labelOf, monthGrid, takeaway, type Meeting } from "./calendar";

const meeting = (o: Partial<Meeting>): Meeting => ({
  id: "v",
  lead_id: "l",
  starts_at: "2026-12-02T05:30:00Z",
  status: "booked",
  kind: "campus",
  meeting_url: null,
  campus: null,
  lead: { child_name: "Aarav", grade: "Jr KG", contact: { name: "Priya" } },
  ...o,
});

describe("monthGrid", () => {
  it("covers December 2026 in Monday-first weeks, and asks the server for exactly those days", () => {
    const g = monthGrid(new Date(2026, 11, 15));
    expect(g.weeks).toHaveLength(5);
    expect(g.weeks[0][0]).toBe("2026-11-30"); // a Monday
    expect(g.weeks[4][6]).toBe("2027-01-03"); // a Sunday
    expect(g.weeks.every((w) => w.length === 7)).toBe(true);
    expect([g.from, g.to]).toEqual(["2026-11-30", "2027-01-04"]);
  });

  it("a month starting on Monday has no leading week from the month before", () => {
    expect(monthGrid(new Date(2027, 1, 1)).weeks[0][0]).toBe("2027-02-01");
  });
});

describe("dayKey", () => {
  it("files a meeting under its India-time day, not UTC's", () => {
    expect(dayKey("2026-12-01T20:00:00Z")).toBe("2026-12-02"); // 1:30 am in Pune
    expect(dayKey("2026-12-01T18:00:00Z")).toBe("2026-12-01"); // 11:30 pm in Pune
  });
});

describe("takeaway", () => {
  const now = new Date("2026-12-05T00:00:00Z");
  it("names unmarked past meetings first, then the next one", () => {
    const line = takeaway([meeting({ starts_at: "2026-12-02T05:30:00Z" }), meeting({ starts_at: "2026-12-08T05:30:00Z", kind: "virtual" })], now);
    expect(line).toMatch(/^1 past meeting is not marked/);
    expect(line).toContain("Next: Aarav (Jr KG), Tue, 8 Dec at 11:00 am · Video call.");
  });

  it("says so when nothing more is booked; a parent's name stands in for a missing child name", () => {
    expect(takeaway([meeting({ status: "visited" })], now)).toBe("Nothing else booked this month.");
    expect(takeaway([meeting({ starts_at: "2026-12-09T05:30:00Z", lead: { child_name: null, grade: null, contact: { name: "Priya" } } })], now)).toContain("Next: Priya,");
  });
});

describe("calls on the Calendar", () => {
  const task = { id: "c", lead_id: "l", due_at: "2026-12-01T05:30:00Z", done_at: null, outcome: null, notes: "fees", lead: null };

  it("an open task sits on its due day as a call to make; a done one on the day it was made, with its outcome", () => {
    const open = callEntry(task);
    expect(open).toMatchObject({ starts_at: task.due_at, status: "to_call", note: "fees" });
    expect(labelOf(open)).toBe("Call to make");
    const done = callEntry({ ...task, done_at: "2026-12-03T05:30:00Z", outcome: "Talked" });
    expect(done).toMatchObject({ starts_at: "2026-12-03T05:30:00Z", status: "called", note: "Talked · fees" });
    expect(labelOf(done)).toBe("Call made");
  });

  it("orders a day as meetings, calls to make, calls made", () => {
    const list = [callEntry({ ...task, done_at: task.due_at }), callEntry(task), meeting({ starts_at: "2026-12-01T09:00:00Z" })];
    expect(list.sort(inDayOrder).map((m) => m.status)).toEqual(["booked", "to_call", "called"]);
  });

  it("the takeaway counts overdue calls, and a made call is never missed or next", () => {
    const now = new Date("2026-12-05T00:00:00Z");
    expect(takeaway([callEntry(task), callEntry({ ...task, done_at: task.due_at })], now)).toBe("1 call is overdue. Nothing else booked this month.");
  });
});
