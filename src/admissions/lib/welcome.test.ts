// The admissions welcome wording (ADR 0033: drafted by Claude, pending Nimish's approval). Whatever the words, the flow
// must still fill the lead: the child's name goes into the date question, the date example is dd/mm/yyyy (what intake
// parses day first), the handoff note carries both answers, and the chat stays short with at most one emoji.
import { describe, expect, it } from "vitest";

import { getFlowTemplate } from "@/lib/flows/templates";
import { parseDob } from "./intake";

const flow = getFlowTemplate("admissions_welcome")!;
const config = (key: string) => flow.nodes.find((n) => n.node_key === key)!.config as Record<string, string>;
const toParent = [config("intro").text, config("ask_child").prompt_text, config("ask_dob").prompt_text, config("thanks").text];

describe("admissions welcome wording", () => {
  it("names the school and the admissions office", () => {
    expect(config("intro").text).toContain("Cornerstone School, Pune");
    expect(config("intro").text).toContain("admissions office");
  });

  it("asks for the date as dd/mm/yyyy with an example intake reads day first", () => {
    const ask = config("ask_dob").prompt_text;
    expect(ask).toContain("{{vars.child_name}}");
    expect(ask).toContain("dd/mm/yyyy");
    const example = /\b\d{2}\/\d{2}\/\d{4}\b/.exec(ask)?.[0];
    expect(parseDob(example)).toBe("2022-03-14");
  });

  it("hands over with both answers in the note", () => {
    expect(config("handoff").note).toContain("{{vars.child_name}}");
    expect(config("handoff").note).toContain("{{vars.child_dob}}");
  });

  it("is short, with at most one emoji in the whole chat", () => {
    for (const line of toParent) expect(line.length).toBeLessThanOrEqual(160);
    expect(toParent.join(" ").match(/\p{Extended_Pictographic}/gu)?.length ?? 0).toBeLessThanOrEqual(1);
  });
});
