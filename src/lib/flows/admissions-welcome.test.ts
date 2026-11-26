import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeTables } from "./fake-db.test-helper";

// ============================================================
// The admissions welcome menu (ADR 0035), driven through the real
// dispatchInboundToFlows and admissions intake against a fake database:
// a scanned QR starts it even for a known number, a tap is kept in the
// run's vars, a call back puts one call on the Today list, a campus tap
// sets the lead's campus, and the booking link carries the parent's
// number and the child's name.
// ============================================================

const h = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  intakeCalls: [] as Record<string, unknown>[],
  sent: [] as string[],
}));

vi.mock("./admin-client", async () => {
  const { createFakeDb } = await import("./fake-db.test-helper");
  return {
    supabaseAdmin: () =>
      createFakeDb(h.tables as FakeTables, new Set(), (name, args) => {
        if (name !== "intake_lead") return { error: null };
        h.intakeCalls.push(args.p_lead as Record<string, unknown>);
        return { data: { contact_id: "c-1", lead_id: "lead-1", created: h.intakeCalls.length === 1 }, error: null };
      }),
  };
});

vi.mock("./meta-send", () => ({
  engineSendText: vi.fn(async (a: { text: string }) => (h.sent.push(a.text), { whatsapp_message_id: "w1" })),
  engineSendMedia: vi.fn(async () => ({ whatsapp_message_id: "w2" })),
  engineSendInteractiveButtons: vi.fn(async (a: { bodyText: string; buttons: { title: string }[] }) => (
    h.sent.push(`${a.bodyText} [${a.buttons.map((b) => b.title).join(" | ")}]`), { whatsapp_message_id: "w3" })),
  engineSendInteractiveList: vi.fn(async () => ({ whatsapp_message_id: "w4" })),
}));

import { CALL_BACK_NOTE, prefilledText } from "@/admissions/lib/intake";
import { dispatchInboundToFlows } from "./engine";
import { getFlowTemplate } from "./templates";
import type { ParsedInbound } from "./types";

const ACCOUNT = "acct-1";
let seq = 0;
const send = (message: Record<string, string>, isFirstInboundMessage = false) =>
  dispatchInboundToFlows({
    accountId: ACCOUNT,
    userId: "u-1",
    contactId: "c-1",
    conversationId: "conv-1",
    message: { ...message, meta_message_id: `wamid.${++seq}` } as ParsedInbound,
    isFirstInboundMessage,
  });
const say = (text: string, first = false) => send({ kind: "text", text }, first);
const tap = (reply_id: string) => send({ kind: "interactive_reply", reply_id, reply_title: reply_id });
const run = () => h.tables.flow_runs.at(-1)!;
const callTasks = () => h.tables.lead_activity.filter((a) => a.kind === "call_task");

beforeEach(() => {
  const flow = getFlowTemplate("admissions_welcome")!;
  h.tables = {
    flows: [{ id: "flow-w", account_id: ACCOUNT, user_id: "u-1", status: "active", trigger_type: flow.trigger_type,
      trigger_config: flow.trigger_config, entry_node_id: flow.entry_node_id, fallback_policy: {}, created_at: "2026-11-26T00:00:00Z" }],
    flow_nodes: flow.nodes.map((n, i) => ({ id: `n${i}`, flow_id: "flow-w", ...n })),
    flow_runs: [],
    flow_run_events: [],
    contacts: [{ id: "c-1", account_id: ACCOUNT, phone_normalized: "919876543210" }],
    admissions_settings: [{ id: "camp-neev", account_id: ACCOUNT, kind: "campus", key: "neev", active: true, value: {} },
      { id: "camp-gurukul", account_id: ACCOUNT, kind: "campus", key: "gurukul", active: true, value: {} }],
    lead_activity: [],
  };
  h.intakeCalls = [];
  h.sent = [];
});

describe("admissions welcome menu", () => {
  it("a scanned QR from a number we already know opens the menu, and the run knows the parent's number", async () => {
    const r = await say(prefilledText("gate_qr"));
    expect(r.consumed).toBe(true);
    expect(h.sent[0]).toContain("[Request a call back | Visit the school | Online meeting]");
    expect(run().vars).toEqual({ contact_phone: "919876543210" });
  });

  it("a plain message from a known number does not open it", async () => {
    expect((await say("Thank you!")).consumed).toBe(false);
    expect(h.sent).toEqual([]);
  });

  it("call back: the tap is kept, one call lands on Today, and the parent is promised 24 hours", async () => {
    await say("Hi", true);
    await tap("call_back");
    expect(run().vars).toMatchObject({ menu: "call_back" });
    expect(callTasks()).toEqual([expect.objectContaining({ lead_id: "lead-1", account_id: ACCOUNT, notes: CALL_BACK_NOTE })]);
    await say("Aarav Shah");
    expect(h.sent.at(-1)).toContain("Aarav Shah's birthday");
    await say("14/03/2022");
    expect(h.sent.at(-1)).toContain("within 24 hours");
    expect(callTasks()).toHaveLength(1); // intake ran on every message; still one call
    expect(h.intakeCalls.at(-1)).toMatchObject({ child: "Aarav Shah", child_dob: "2022-03-14" });
  });

  it("visit: the campus tap sets the campus and the link opens that campus's calendar for this family", async () => {
    await say("Hi", true);
    await tap("visit");
    await say("Aarav Shah");
    await say("14/03/2022");
    expect(h.sent.at(-1)).toContain("[Neev (Playgroup–KG) | Gurukul (Grade 1–7)]");
    await tap("neev");
    expect(h.sent.at(-1)).toContain(
      "https://cal.com/nimish-shah-zp0z89/school-visit-neev?attendeePhoneNumber=%2B919876543210&child-first-name=Aarav%20Shah");
    expect(h.intakeCalls.at(-1)).toMatchObject({ campus_id: "camp-neev" });
    expect(callTasks()).toEqual([]);
    expect(run().status).toBe("completed");
  });

  it("online meeting: straight to the online calendar after the child's details", async () => {
    await say("Hi", true);
    await tap("online");
    await say("Meera");
    await say("01/06/2019");
    expect(h.sent.at(-1)).toContain("/online-meeting?attendeePhoneNumber=%2B919876543210&child-first-name=Meera");
    expect(callTasks()).toEqual([]);
  });
});
