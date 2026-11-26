// #8 · The page rules' helpers: empty cells, which columns show, paging, grouping, alignment.
import { describe, expect, it } from "vitest";
import { alignOf, groupRows, isEmptyCell, pageOf, visibleColumns, type Column } from "./ux-rules";

describe("isEmptyCell", () => {
  it.each([null, undefined, false, "", "  ", "-", "—", 0, "0"])("%j says nothing", (v) => expect(isEmptyCell(v)).toBe(true));
  it.each(["Aarav", 3, "12", "Wakad"])("%j says something", (v) => expect(isEmptyCell(v)).toBe(false));
});

type Row = { name: string; calls: number | null };
const cols: Column<Row>[] = [
  { key: "name", label: "Parent", value: (r) => r.name },
  { key: "calls", label: "Calls", value: (r) => r.calls, num: true },
];

describe("visibleColumns", () => {
  it("drops a column whose every value is empty", () => {
    const rows = [{ name: "Sunita", calls: 0 }, { name: "Ravi", calls: null }];
    expect(visibleColumns(cols, rows).map((c) => c.key)).toEqual(["name"]);
  });

  it("keeps a column when one row has a value", () => {
    const rows = [{ name: "Sunita", calls: 0 }, { name: "Ravi", calls: 2 }];
    expect(visibleColumns(cols, rows).map((c) => c.key)).toEqual(["name", "calls"]);
  });
});

describe("pageOf", () => {
  const rows = Array.from({ length: 23 }, (_, i) => i + 1);
  it("cuts the rows into pages of ten", () => {
    expect(pageOf(rows, 2)).toEqual({ rows: [11, 12, 13, 14, 15, 16, 17, 18, 19, 20], page: 2, pages: 3 });
  });
});

describe("groupRows and alignOf", () => {
  it("groups rows in order of first appearance", () => {
    const rows = [{ s: "Visit" }, { s: "Enquiry" }, { s: "Visit" }];
    expect(groupRows(rows, (r) => r.s)).toEqual([
      { name: "Visit", rows: [{ s: "Visit" }, { s: "Visit" }] },
      { name: "Enquiry", rows: [{ s: "Enquiry" }] },
    ]);
  });

  it("puts numbers right, states centre, text left", () => {
    expect(alignOf({ num: true })).toBe("right");
    expect(alignOf({ status: true })).toBe("center");
    expect(alignOf({})).toBe("left");
  });
});
