// The admissions welcome flow (ADR 0033 wording, ADR 0035 menu). Whatever the words, the flow must still fill the lead:
// three choices that fit WhatsApp buttons, the child's name goes into the date question, the date example is dd/mm/yyyy
// (what intake parses day first), the call back promises 24 hours, the campus buttons carry the campus tags, the
// booking links carry the parent's number and the child's name, and the chat stays short with at most one emoji.
import { describe, expect, it } from "vitest";

import { getFlowTemplate } from "@/lib/flows/templates";
import { validateFlowForActivation } from "@/lib/flows/validate";
import { CALL_BACK, parseDob } from "./intake";

const flow = getFlowTemplate("admissions_welcome")!;
const node = (key: string) => flow.nodes.find((n) => n.node_key === key)!;
const config = (key: string) => node(key).config as Record<string, string>;
const buttons = (key: string) => (node(key).config as { buttons: { reply_id: string; title: string; next_node_key: string }[] }).buttons;
const links = ["neev_link", "gurukul_link", "online_link"];
const toParent = [config("menu").text, config("ask_child").prompt_text, config("ask_dob").prompt_text, config("call_thanks").text,
  config("campus").text, ...links.map((k) => config(k).text)];

describe("admissions welcome menu", () => {
  it("passes the activation checks", () => {
    expect(validateFlowForActivation(flow as never, flow.nodes as never).filter((i) => i.severity === "error")).toEqual([]);
  });

  it("offers a call back, a visit and an online meeting, each a WhatsApp button (20 characters at most)", () => {
    expect(buttons("menu").map((b) => b.reply_id)).toEqual([CALL_BACK, "visit", "online"]);
    for (const b of [...buttons("menu"), ...buttons("campus")]) expect(b.title.length).toBeLessThanOrEqual(20);
  });

  it("names the school, and promises the call within 24 hours", () => {
    expect(config("menu").text).toContain("Cornerstone School, Pune");
    expect(config("call_thanks").text).toContain("within 24 hours");
  });

  it("asks for the date as dd/mm/yyyy with an example intake reads day first", () => {
    const ask = config("ask_dob").prompt_text;
    expect(ask).toContain("{{vars.child_name}}");
    expect(ask).toContain("dd/mm/yyyy");
    const example = /\b\d{2}\/\d{2}\/\d{4}\b/.exec(ask)?.[0];
    expect(parseDob(example)).toBe("2022-03-14");
  });

  it("the campus buttons are the campus tags, each to its own calendar", () => {
    expect(buttons("campus").map((b) => [b.reply_id, b.next_node_key])).toEqual([["neev", "neev_link"], ["gurukul", "gurukul_link"]]);
    expect(config("neev_link").text).toContain("/school-visit-neev?");
    expect(config("gurukul_link").text).toContain("/school-visit?");
    expect(config("online_link").text).toContain("/online-meeting?");
  });

  it("every booking link carries the parent's number and the child's name, URL-encoded", () => {
    for (const k of links) {
      expect(config(k).text).toContain("attendeePhoneNumber=%2B{{vars.contact_phone}}");
      expect(config(k).text).toContain("child-first-name={{vars.child_name|url}}");
    }
  });

  it("is short and warm, with at most one emoji in the whole chat", () => {
    for (const line of toParent) expect(line.replace(/https:\S+/g, "").length).toBeLessThanOrEqual(160);
    expect(toParent.join(" ").match(/\p{Extended_Pictographic}/gu)?.length ?? 0).toBeLessThanOrEqual(1);
  });
});
