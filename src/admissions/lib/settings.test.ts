// #70 · Setting values are checked at the API boundary; the change log says what changed in words.
import { describe, expect, it } from "vitest";
import { checkLabel, checkValue, describeChange, keyFor, stuckKey, UNTOUCHED_KEY } from "./settings";

describe("checkValue", () => {
  it("accepts a call-task rule and drops a stray template", () => {
    expect(checkValue("follow_up_rule", "k", { stage: "Enquiry", days: 3, action: "call_task", template: "x" })).toEqual({
      ok: true,
      value: { stage: "Enquiry", days: 3, action: "call_task" },
    });
  });

  it.each([
    [{ stage: "Nowhere", days: 1, action: "call_task" }, "Pick a stage."],
    [{ stage: "Enquiry", days: -1, action: "call_task" }, "Enter 0 to 365 days."],
    [{ stage: "Enquiry", days: 1.5, action: "call_task" }, "Enter 0 to 365 days."],
    [{ stage: "Enquiry", days: 1, action: "email" }, "Pick what the rule does."],
    [{ stage: "Enquiry", days: 1, action: "send_template" }, "Pick a template."],
  ])("rejects the rule %j", (value, error) => {
    expect(checkValue("follow_up_rule", "k", value)).toEqual({ ok: false, error });
  });

  it("holds untouched to 1–168 hours (wireframe: bad value)", () => {
    expect(checkValue("alert", UNTOUCHED_KEY, { threshold: 0 })).toEqual({ ok: false, error: "Enter 1 to 168 hours." });
    expect(checkValue("alert", UNTOUCHED_KEY, { threshold: 24 })).toEqual({ ok: true, value: { threshold: 24 } });
  });

  it("knows the stuck alerts by stage and refuses unknown alert keys", () => {
    // the shape M3's board reads (ADR 0024 §4): key stuck_<stage>, value {stage, threshold}
    expect(stuckKey("Visit booked")).toBe("stuck_visit_booked");
    expect(checkValue("alert", "stuck_visit_booked", { stage: "Applied", threshold: 7 })).toEqual({
      ok: true,
      value: { stage: "Visit booked", threshold: 7 },
    });
    expect(checkValue("alert", "made_up", { threshold: 7 })).toEqual({ ok: false, error: "Unknown alert." });
  });

  it("checks a campus's dates and link, keeping only known fields", () => {
    expect(checkValue("campus", "neev", { born_from: "2020-13-45" }).ok).toBe(false);
    expect(checkValue("campus", "neev", { visit_link: "javascript:alert(1)" }).ok).toBe(false);
    expect(checkValue("campus", "neev", { grades: "Playgroup – Sr KG", born_from: "2020-06-01", evil: 1 })).toEqual({
      ok: true,
      value: { grades: "Playgroup – Sr KG", born_from: "2020-06-01" },
    });
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
    expect(keyFor("follow_up_rule", "x", { stage: "Visit booked", days: 7, action: "call_task" })).toBe("visit_booked_day_7_call_task");
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
});
