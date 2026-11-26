import { describe, expect, it } from "vitest";

import { isLeadSheet, parseLeadSheet, sheetDate, sheetPhone } from "./import";

const look = {
  campuses: [{ id: "c-neev", label: "Neev" }],
  sources: [{ id: "s-walk", label: "Walk-in" }],
  stages: ["Enquiry", "Visit booked", "Visited", "Deciding", "Applied", "Admitted"].map((n) => ({ id: `st-${n}`, label: n })),
};

describe("sheetPhone", () => {
  it.each([
    ["98765 43210", "919876543210"],
    ["098765-43210", "919876543210"],
    ["919876543210", "919876543210"],
    ["+91 98765 43210", "919876543210"],
    ["+1 (415) 555-1212", "14155551212"],
  ])("%s → %s", (raw, out) => expect(sheetPhone(raw)).toBe(out));

  it.each(["", "12345", "4155551212", "abc", "+91"])("refuses %j", (raw) => expect(sheetPhone(raw)).toBeNull());
});

describe("isLeadSheet", () => {
  it("is a lead sheet only with a child column", () => {
    expect(isLeadSheet('"Phone","Child Name"\n1,2')).toBe(true);
    expect(isLeadSheet("phone,name,email\n1,2,3")).toBe(false);
  });
});

describe("parseLeadSheet validates every row at the boundary", () => {
  const csv = [
    "Phone,Parent,Child,Grade,Campus,Source,Stage,Area",
    "98765 43210,Asha,Riya,Nursery,neev,walk-in,Visited,Baner",
    "98765 43211,Ravi,Kabir,,,,,",
    ",No phone,X,,,,,",
    "98765 43212,P,C,,Gurukul,,,",
    "98765 43213,P,C,,,Billboard,,",
    "98765 43214,P,C,,,,Signed,",
    "98765 43215,P,C,,,,Admitted,",
    "",
    '"98765 43216","Shah, Meera",Dev,,,,,',
  ].join("\n");
  const { rows, lines, errors } = parseLeadSheet(csv, look);

  it("keeps good rows, mapping labels to ids in any case, first stage by default", () => {
    expect(rows).toEqual([
      { phone: "919876543210", parent: "Asha", child: "Riya", grade: "Nursery", area: "Baner", campus_id: "c-neev", source_id: "s-walk", stage_id: "st-Visited" },
      { phone: "919876543211", parent: "Ravi", child: "Kabir", grade: "", area: "", campus_id: null, source_id: null, stage_id: "st-Enquiry" },
      { phone: "919876543216", parent: "Shah, Meera", child: "Dev", grade: "", area: "", campus_id: null, source_id: null, stage_id: "st-Enquiry" },
    ]);
    expect(lines).toEqual([2, 3, 10]);
  });

  it("reports each bad row with its line and reason", () => {
    expect(errors.map((e) => [e.line, e.reason])).toEqual([
      [4, "No valid phone number (10 digits, or +country code)."],
      [5, 'Unknown campus "Gurukul". Add it in Admissions settings first.'],
      [6, 'Unknown source "Billboard". Add it in Admissions settings first.'],
      [7, 'Unknown stage "Signed".'],
      [8, "Admitted families are not imported: only live enquiries."],
    ]);
  });

  it("needs a phone column", () => {
    expect(parseLeadSheet("child,grade\nA,B", look).errors).toEqual([{ line: 1, phone: "", reason: "The sheet needs a phone column." }]);
  });
});

describe("#71 review: cells and enquiry dates", () => {
  it("strips only the quotes that wrap a cell", () => {
    const { rows } = parseLeadSheet("phone,parent,child\n'9876543210',\"D'Souza\",O'Brien", look);
    expect(rows[0]).toMatchObject({ phone: "919876543210", parent: "D'Souza", child: "O'Brien" });
  });

  it("reads the enquiry date day first, as India writes it, and refuses a date that isn't a past one", () => {
    const now = new Date("2026-11-26T10:00:00+05:30");
    expect(sheetDate("25/11/2026", now)).toBe("2026-11-25T00:00:00+05:30");
    expect(sheetDate("5-1-2026", now)).toBe("2026-01-05T00:00:00+05:30");
    expect(sheetDate("2026-03-09", now)).toBe("2026-03-09T00:00:00+05:30");
    expect(sheetDate("", now)).toBe("");
    for (const bad of ["31/02/2026", "27/11/2026", "11/25", "yesterday"]) expect(sheetDate(bad, now)).toBeNull();
  });

  it("puts the enquiry date on the row, or reports the line", () => {
    const { rows, errors } = parseLeadSheet("phone,child,enquiry date\n9876543210,A,01/06/2026\n9876543211,B,\n9876543212,C,31/02/2026", look);
    expect(rows.map((r) => r.enquired_at)).toEqual(["2026-06-01T00:00:00+05:30", undefined]);
    expect(errors.map((e) => e.line)).toEqual([4]);
  });
});
