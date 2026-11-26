// #69 · Sending the follow-ups the database claimed (tests/db/m6-follow-ups.test.ts covers what gets claimed): each claimed
// send goes out once through wacrm's sender and is stamped done; a failed send is recorded and never retried.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  claimed: [] as unknown[],
  claimError: null as { message: string } | null,
  conversation: { id: "conv-1" } as { id: string } | null,
  updates: [] as { row: Record<string, unknown>; id: unknown }[],
  send: vi.fn(),
}));

vi.mock("@/lib/automations/admin-client", () => ({
  supabaseAdmin: () => ({
    rpc: async () => ({ data: h.claimed, error: h.claimError }),
    from: (table: string) => {
      let row: Record<string, unknown> | null = null;
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.update = (r: Record<string, unknown>) => ((row = r), b);
      b.eq = (col: string, v: unknown) => {
        if (row && col === "id") h.updates.push({ row, id: v });
        return row ? Promise.resolve({ error: null }) : b;
      };
      b.maybeSingle = async () => ({
        data: table === "conversations" ? h.conversation : { id: "msg-uuid" },
        error: null,
      });
      return b;
    },
  }),
}));
vi.mock("@/lib/automations/meta-send", () => ({ engineSendTemplate: h.send }));

import { runFollowUps } from "./follow-ups";

const SEND = { activity_id: "act-1", account_id: "acc-1", contact_id: "con-1", owner_id: "own-1", template: "visit_feedback" };

beforeEach(() => {
  h.claimed = [SEND];
  h.claimError = null;
  h.conversation = { id: "conv-1" };
  h.updates = [];
  h.send.mockReset().mockResolvedValue({ whatsapp_message_id: "wamid.1" });
});

describe("runFollowUps", () => {
  it("sends each claimed template once, in the parent's conversation, and stamps it done with its message", async () => {
    expect(await runFollowUps()).toEqual({ sent: 1, failed: 0 });
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.send).toHaveBeenCalledWith({
      accountId: "acc-1",
      userId: "own-1",
      conversationId: "conv-1",
      contactId: "con-1",
      templateName: "visit_feedback",
    });
    expect(h.updates).toEqual([{ id: "act-1", row: { done_at: expect.any(String), message_id: "msg-uuid" } }]);
  });

  it("sends nothing when nothing was claimed (already sent, paused, switched off or not due)", async () => {
    h.claimed = [];
    expect(await runFollowUps()).toEqual({ sent: 0, failed: 0 });
    expect(h.send).not.toHaveBeenCalled();
  });

  it("records a failed send on the follow-up and carries on", async () => {
    h.claimed = [SEND, { ...SEND, activity_id: "act-2" }];
    h.send.mockRejectedValueOnce(new Error("Template not approved"));
    expect(await runFollowUps()).toEqual({ sent: 1, failed: 1 });
    expect(h.updates[0]).toEqual({ id: "act-1", row: { outcome: "Not sent", notes: "Template not approved" } });
  });

  it("does not send without a conversation with the parent", async () => {
    h.conversation = null;
    expect(await runFollowUps()).toEqual({ sent: 0, failed: 1 });
    expect(h.send).not.toHaveBeenCalled();
  });

  it("reports a failed claim instead of throwing, so the automations still drain", async () => {
    h.claimError = { message: "boom" };
    expect(await runFollowUps()).toEqual({ sent: 0, failed: 0, error: "boom" });
  });
});
