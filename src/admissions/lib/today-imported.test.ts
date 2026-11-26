// #87 review fix (a): an imported lead (migration 117) is never untouched because of the import or the sheet's old
// enquiry date, even when no person shows on its first stage entry; only a parent's message after the import counts.
// A lead staff add by hand still counts as touched.
import { describe, expect, it } from "vitest";
import { buildToday, type OpenLead } from "./today";

const NOW = new Date("2026-11-25T06:30:00Z");
const ago = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

const lead = (o: Partial<OpenLead> & { inbound?: string }): OpenLead => {
  const { inbound, ...rest } = o;
  return {
    id: "l",
    child_name: "Ira",
    grade: null,
    created_at: ago(24 * 60), // the sheet's enquiry date, two months back
    days_in_stage: 0,
    deal: { stage_id: "s" },
    contact: { name: "Neha", conversations: [{ last_inbound_at: inbound ?? null, last_reply_at: null }] },
    lead_stage_history: [{ entered_at: ago(48), moved_by: null }],
    lead_activity: [],
    ...rest,
  };
};
const untouched = (l: OpenLead) =>
  buildToday(
    { leads: [l], tasks: [], visits: [], alerts: [{ key: "untouched", value: { threshold: 24 } }], stages: [{ id: "s", name: "Enquiry" }] },
    NOW,
  ).counts.untouched;

describe("untouched and imported leads", () => {
  it("does not list an imported lead for its import or its old enquiry date", () => {
    expect(untouched(lead({ imported_at: ago(48) }))).toBe(0);
  });

  it("does not list it for a message the parent sent before the import", () => {
    expect(untouched(lead({ imported_at: ago(48), inbound: ago(24 * 30) }))).toBe(0);
  });

  it("lists it once the parent writes after the import and nobody answers", () => {
    expect(untouched(lead({ imported_at: ago(48), inbound: ago(30) }))).toBe(1);
  });

  it("still counts a lead staff added by hand as touched", () => {
    const at = ago(48);
    expect(untouched(lead({ created_at: at, lead_stage_history: [{ entered_at: at, moved_by: "staff" }] }))).toBe(0);
  });
});
