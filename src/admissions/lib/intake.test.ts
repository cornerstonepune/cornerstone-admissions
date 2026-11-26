// M4 one door (#67): the pure parts of intake — phone in any format, date of birth, campus by cut-off, source codes.
import { describe, expect, it } from "vitest";

import { parseDob, phoneDigits, prefilledText, routeByDob, sourceCode, waLink, type Campus } from "./intake";

describe("phone in any format (G4.1)", () => {
  it.each(["+91 98765 43210", "98765 43210", "9876543210", "098765-43210", "919876543210", "+91-98765-43210", "+919876543210"])(
    "%s is 919876543210",
    (raw) => expect(phoneDigits(raw)).toBe("919876543210"),
  );
  it.each(["98765 12", "", "12345678901", "abc"])("%s is refused", (raw) => expect(phoneDigits(raw)).toBeNull());
});

describe("date of birth as a parent types it", () => {
  it.each([
    ["14/03/2022", "2022-03-14"],
    ["14-3-2022", "2022-03-14"],
    ["14.03.2022", "2022-03-14"],
    ["2022-03-14", "2022-03-14"],
    ["14 March 2022", "2022-03-14"],
    ["14th Mar, 2022", "2022-03-14"],
    [" 1/6/2021 ", "2021-06-01"],
  ])("%s → %s", (raw, iso) => expect(parseDob(raw)).toBe(iso));
  it.each(["31/02/2022", "2022-13-01", "next year", "14 Smarch 2022", "", "03/14/2022"])("%s is not a date", (raw) =>
    expect(parseDob(raw)).toBeNull(),
  );
});

describe("G4.2 date of birth routes to the campus and grade at the cut-off", () => {
  // Nursery takes children born before the cut-off 2022-06-01; Playgroup from the cut-off on.
  const campuses: Campus[] = [
    { id: "nursery", value: { grades: "Nursery", born_from: "2021-06-01", born_before: "2022-06-01" } },
    { id: "playgroup", value: { grades: "Playgroup", born_from: "2022-06-01", born_before: "2023-06-01" } },
    { id: "gurukul", value: { grades: "Grade 1 – Grade 7" } }, // no dates: never routed to
  ];
  it("the day before the cut-off is the older grade", () =>
    expect(routeByDob("2022-05-31", campuses)).toEqual({ campus_id: "nursery", grade: "Nursery" }));
  it("on the cut-off is the younger grade", () =>
    expect(routeByDob("2022-06-01", campuses)).toEqual({ campus_id: "playgroup", grade: "Playgroup" }));
  it("the day after the cut-off is the younger grade", () =>
    expect(routeByDob("2022-06-02", campuses)).toEqual({ campus_id: "playgroup", grade: "Playgroup" }));
  it("outside every window routes nowhere", () => expect(routeByDob("2019-01-01", campuses)).toEqual({}));
  it("a campus with a range of grades gets the campus, not a grade", () =>
    expect(routeByDob("2018-01-01", [{ id: "g", value: { grades: "Grade 1 – Grade 7", born_before: "2019-06-01" } }])).toEqual({
      campus_id: "g",
    }));
  it("two campuses matching routes nowhere, for staff to pick", () =>
    expect(routeByDob("2022-01-01", [...campuses, { id: "other", value: { born_from: "2021-01-01" } }])).toEqual({}));
});

describe("source codes on WhatsApp links", () => {
  it("a source's link carries its code, and the first message gives it back", () => {
    const link = new URL(waLink("+91 98220 12345", "gate_qr"));
    expect(link.origin + link.pathname).toBe("https://wa.me/919822012345");
    expect(sourceCode(link.searchParams.get("text"))).toBe("gate_qr");
  });
  it("reads the code whatever the parent's capitals", () => expect(sourceCode(prefilledText("insta").toUpperCase())).toBe("insta"));
  it("a message with no code has none", () => {
    expect(sourceCode("Hi, admissions for my son please")).toBeNull();
    expect(sourceCode(null)).toBeNull();
  });
});
