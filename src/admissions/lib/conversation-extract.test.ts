// ADR 0039: Claude's sections are checked before they reach the database. Claude is mocked (no network).
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { claudeExtractor, CONCERN_TAGS, parseExtraction } from "./conversation-extract";

const stages = ["Enquiry", "Visit booked", "Visited"];

describe("parseExtraction", () => {
  it("keeps well-formed sections", () => {
    expect(
      parseExtraction(
        {
          summary: " Mother asked about fees and the bus. ",
          concerns: [{ tag: "fees", detail: "Wants instalments" }],
          questions: ["Is there a bus from Baner?"],
          action_points: [{ text: "Send the fee sheet", owner: "school", due: "2026-11-28" }],
          interest: "warm",
          suggested_stage: "visit booked",
        },
        stages,
      ),
    ).toEqual({
      summary: "Mother asked about fees and the bus.",
      concerns: [{ tag: "fees", detail: "Wants instalments" }],
      questions: ["Is there a bus from Baner?"],
      action_points: [{ text: "Send the fee sheet", owner: "school", due: "2026-11-28" }],
      interest: "warm",
      suggested_stage: "Visit booked",
    });
  });

  it("turns an unknown tag into other and drops empty items", () => {
    const x = parseExtraction(
      {
        summary: "s",
        concerns: [{ tag: "parking", detail: "No parking" }, { tag: "fees", detail: "" }, "junk"],
        questions: ["", 3, "When?"],
        action_points: [{ text: "" }, { text: "Call back", owner: "unknown", due: "next week" }],
      },
      stages,
    );
    expect(x.concerns).toEqual([{ tag: "other", detail: "No parking" }]);
    expect(x.questions).toEqual(["When?"]);
    expect(x.action_points).toEqual([{ text: "Call back", owner: null, due: null }]);
  });

  it("drops an unknown interest and a stage not in the pipeline", () => {
    const x = parseExtraction({ summary: "s", interest: "unknown", suggested_stage: "Enrolled" }, stages);
    expect(x.interest).toBeNull();
    expect(x.suggested_stage).toBeNull();
  });

  it("refuses an answer without a summary", () => {
    expect(() => parseExtraction({ concerns: [] }, stages)).toThrow(/summary/);
    expect(() => parseExtraction(null, stages)).toThrow(/summary/);
  });

  it("has the fixed concern list", () => {
    expect(CONCERN_TAGS).toContain("comparing_schools");
    expect(CONCERN_TAGS.at(-1)).toBe("other");
  });
});

function fakeClient(response: object) {
  const create = vi.fn(async () => response);
  return { client: { beta: { messages: { create } } } as unknown as Anthropic, create };
}

describe("claudeExtractor", () => {
  const input = { text: "Staff note: fees too high", kind: "call", happenedAt: "2026-11-26", stages };

  it("asks Sonnet for JSON in the schema and parses it", async () => {
    const { client, create } = fakeClient({
      stop_reason: "end_turn",
      content: [{ type: "text", text: JSON.stringify({ summary: "Fees worry.", concerns: [{ tag: "fees", detail: "High" }] }) }],
    });
    const x = await claudeExtractor(client)(input);
    expect(x.summary).toBe("Fees worry.");
    const params = (create.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(params.model).toBe("claude-sonnet-5-5");
    expect(params.output_config).toMatchObject({ format: { type: "json_schema" } });
  });

  it("fails on a refusal or a cut-off answer", async () => {
    await expect(claudeExtractor(fakeClient({ stop_reason: "refusal", content: [] }).client)(input)).rejects.toThrow(/declined/);
    await expect(claudeExtractor(fakeClient({ stop_reason: "max_tokens", content: [] }).client)(input)).rejects.toThrow(/cut off/);
  });

  it("fails on text that isn't JSON", async () => {
    const { client } = fakeClient({ stop_reason: "end_turn", content: [{ type: "text", text: "Sure! Here you go" }] });
    await expect(claudeExtractor(client)(input)).rejects.toThrow(/wrong shape/);
  });
});
