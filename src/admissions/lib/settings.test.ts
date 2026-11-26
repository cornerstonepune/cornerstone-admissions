// #70 · Setting values are checked at the API boundary; the change log says what changed in words.
// Rules and stuck alerts hold a stage's id, so renaming the stage breaks nothing (#81 review, ADR 0025).
import { describe, expect, it } from "vitest";
import { checkLabel, checkValue, describeChange, isDate, keyFor, ruleKey, stuckKey, UNTOUCHED_KEY } from "./settings";

const ENQUIRY = "6f1c2b9e-1d2a-4c3b-8e4f-5a6b7c8d9e0f";
const VISIT_BOOKED = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

describe("checkValue", () => {
  it("accepts a call-task rule and drops a stray template", () => {
    expect(checkValue("follow_up_rule", "k", { stage: ENQUIRY, days: 3, action: "call_task", template: "x" })).toEqual({
      ok: true,
      value: { stage: ENQUIRY, days: 3, action: "call_task" },
    });
  });

  it.each([
    [{ stage: "Enquiry", days: 1, action: "call_task" }, "Pick a stage."],
    [{ stage: ENQUIRY, days: -1, action: "call_task" }, "Enter 0 to 365 days."],
    [{ stage: ENQUIRY, days: 1.5, action: "call_task" }, "Enter 0 to 365 days."],
    [{ stage: ENQUIRY, days: 1, action: "email" }, "Pick what the rule does."],
    [{ stage: ENQUIRY, days: 1, action: "send_template" }, "Pick a template."],
  ])("rejects the rule %j", (value, error) => {
    expect(checkValue("follow_up_rule", "k", value)).toEqual({ ok: false, error });
  });

  it("holds untouched to 1–168 hours (wireframe: bad value)", () => {
    expect(checkValue("alert", UNTOUCHED_KEY, { threshold: 0 })).toEqual({ ok: false, error: "Enter 1 to 168 hours." });
    expect(checkValue("alert", UNTOUCHED_KEY, { threshold: 24 })).toEqual({ ok: true, value: { threshold: 24 } });
  });

  it("keys a stuck alert by its stage id and takes the stage from the key, not the caller", () => {
    expect(stuckKey(VISIT_BOOKED)).toBe("stuck_0a1b2c3d_4e5f_4a6b_8c7d_9e0f1a2b3c4d");
    expect(checkValue("alert", stuckKey(VISIT_BOOKED), { stage: ENQUIRY, threshold: 7 })).toEqual({
      ok: true,
      value: { stage: VISIT_BOOKED, threshold: 7 },
    });
    expect(checkValue("alert", "made_up", { threshold: 7 })).toEqual({ ok: false, error: "Unknown alert." });
    expect(checkValue("alert", "stuck_visit_booked", { threshold: 7 })).toEqual({ ok: false, error: "Unknown alert." });
  });

  it("checks a campus's dates and link, keeping only known fields", () => {
    expect(checkValue("campus", "neev", { born_from: "2020-13-45" }).ok).toBe(false);
    expect(checkValue("campus", "neev", { visit_link: "javascript:alert(1)" }).ok).toBe(false);
    expect(checkValue("campus", "neev", { grades: "Playgroup – Sr KG", born_from: "2020-06-01", evil: 1 })).toEqual({
      ok: true,
      value: { grades: "Playgroup – Sr KG", born_from: "2020-06-01" },
    });
  });

  it("refuses a date that doesn't exist and a cut-off range the wrong way round (#81 review)", () => {
    expect(isDate("2020-02-30")).toBe(false);
    expect(isDate("2021-02-29")).toBe(false);
    expect(isDate("2020-02-29")).toBe(true);
    expect(checkValue("campus", "neev", { born_from: "2020-02-30" }).ok).toBe(false);
    expect(checkValue("campus", "neev", { born_from: "2020-06-01", born_before: "2019-06-01" }).ok).toBe(false);
    expect(checkValue("campus", "neev", { born_from: "2020-06-01", born_before: "2020-06-01" }).ok).toBe(false);
    expect(checkValue("campus", "neev", { born_from: "2019-06-01", born_before: "2020-06-01" }).ok).toBe(true);
  });

  it("keeps sources and lost reasons to a name", () => {
    expect(checkValue("source", "gate", { anything: 1 })).toEqual({ ok: true, value: {} });
  });
});

describe("checkLabel and keyFor", () => {
  it("needs a name", () => {
    expect(checkLabel("  ").ok).toBe(false);
    expect(checkLabel(" Fees ")).toEqual({ ok: true, value: "Fees" });
  });

  it("derives keys", () => {
    expect(keyFor("lost_reason", "Chose another school", {})).toBe("chose_another_school");
    expect(keyFor("source", "Gate QR", {}, "gate")).toBe("gate");
  });

  it("generates a key for a name with no Latin letters (#81 review)", () => {
    expect(keyFor("lost_reason", "शुल्क जास्त", {})).toMatch(/^lost_reason_[0-9a-f]{8}$/);
    expect(keyFor("source", "गेट", {}, "")).toMatch(/^source_[0-9a-f]{8}$/);
  });

  it("keys a rule by every field that defines it (#81 review)", () => {
    const rule = { stage: ENQUIRY, days: 7, action: "send_template", template: "nudge_second" };
    expect(keyFor("follow_up_rule", "x", rule)).toBe(ruleKey(rule));
    expect(ruleKey(rule)).toMatch(/^[a-z0-9_]+$/);
    // same stage and day, different template: different rules
    expect(ruleKey(rule)).not.toBe(ruleKey({ ...rule, template: "nudge_booking_link" }));
    expect(ruleKey(rule)).not.toBe(ruleKey({ ...rule, days: 8 }));
    expect(ruleKey(rule)).not.toBe(ruleKey({ ...rule, stage: VISIT_BOOKED }));
  });
});

describe("describeChange", () => {
  const rule = { label: "Applied, day 3", active: true, sort_order: 0, value: { threshold: 14 } };
  it("names an added setting", () => {
    expect(describeChange({ action: "insert", old_value: null, new_value: { label: "Open-house event" } })).toBe("added Open-house event");
  });
  it("says a setting was switched off", () => {
    expect(describeChange({ action: "update", old_value: rule, new_value: { ...rule, active: false } })).toBe("Applied, day 3 switched off");
  });
  it("shows a value change as before → after", () => {
    expect(describeChange({ action: "update", old_value: rule, new_value: { ...rule, value: { threshold: 21 } } })).toBe(
      "Applied, day 3 threshold 14 → 21",
    );
  });
  it("shows a stage by today's name, not its id", () => {
    const r = { label: "r", value: { stage: ENQUIRY, days: 1 } };
    const names = { [ENQUIRY]: "Enquiry", [VISIT_BOOKED]: "Visit booked" };
    expect(describeChange({ action: "update", old_value: r, new_value: { ...r, value: { stage: VISIT_BOOKED, days: 1 } } }, names)).toBe(
      "r stage Enquiry → Visit booked",
    );
  });
});
