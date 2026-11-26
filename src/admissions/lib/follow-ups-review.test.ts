// #87 review fixes for the follow-up sender: (d) a failed stamp is reported, and a send that went out is never relabelled
// "Not sent"; (e) the template goes out in its own approved language, not always en_US.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  templates: [] as { language: string | null }[],
  updateError: null as { message: string } | null,
  updates: [] as Record<string, unknown>[],
  send: vi.fn(),
}));

vi.mock("@/lib/automations/admin-client", () => ({
  supabaseAdmin: () => ({
    rpc: async () => ({
      data: [{ activity_id: "act-1", account_id: "acc-1", contact_id: "con-1", owner_id: "own-1", template: "fees_info" }],
      error: null,
    }),
    from: (table: string) => {
      let row: Record<string, unknown> | null = null;
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.update = (r: Record<string, unknown>) => ((row = r), h.updates.push(r), b);
      b.eq = () => (row ? Promise.resolve({ error: h.updateError }) : b);
      b.maybeSingle = async () => ({ data: table === "conversations" ? { id: "conv-1" } : { id: "msg-1" }, error: null });
      b.then = (resolve: (v: unknown) => void) => resolve({ data: table === "message_templates" ? h.templates : [], error: null });
      return b;
    },
  }),
}));
vi.mock("@/lib/automations/meta-send", () => ({ engineSendTemplate: h.send }));

import { runFollowUps } from "./follow-ups";

beforeEach(() => {
  h.templates = [];
  h.updateError = null;
  h.updates = [];
  h.send.mockReset().mockResolvedValue({ whatsapp_message_id: "wamid.1" });
});

describe("(e) the template's own language", () => {
  it("sends in the approved template's language", async () => {
    h.templates = [{ language: "mr" }];
    await runFollowUps();
    expect(h.send).toHaveBeenCalledWith(expect.objectContaining({ templateName: "fees_info", language: "mr" }));
  });

  it("leaves the language to the sender when no stored row names one", async () => {
    await runFollowUps();
    expect(h.send.mock.calls[0][0].language).toBeUndefined();
  });
});

describe("(d) the stamp's error is checked", () => {
  it("reports a send whose stamp failed as sent but unrecorded, never as Not sent", async () => {
    h.updateError = { message: "permission denied" };
    expect(await runFollowUps()).toEqual({ sent: 1, failed: 0, unrecorded: 1 });
    expect(h.updates).toEqual([{ done_at: expect.any(String), message_id: "msg-1" }]);
  });

  it("reports a failed send whose Not sent stamp also failed", async () => {
    h.send.mockRejectedValueOnce(new Error("Meta said no"));
    h.updateError = { message: "permission denied" };
    expect(await runFollowUps()).toEqual({ sent: 0, failed: 1, unrecorded: 1 });
    expect(h.updates).toEqual([{ outcome: "Not sent", notes: "Meta said no" }]);
  });
});
