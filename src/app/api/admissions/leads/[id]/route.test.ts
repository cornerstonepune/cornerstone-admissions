// G3.3 (API): Lost without a lost reason is refused with 422. The fake stands in for the database's
// leads_lost_has_reason check (tests/db/m3-pipeline.test.ts proves the real one); this proves the route's answer.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  updates: [] as Record<string, unknown>[],
  rpc: vi.fn(async () => ({ error: null as null | { code: string; message: string } })),
}));

function fakeSupabase() {
  return {
    rpc: h.rpc,
    from: () => ({
      update: (row: Record<string, unknown>) => {
        h.updates.push(row);
        const chain = {
          eq: () => chain,
          is: () => chain,
          select: async () =>
            row.exit === "lost" && !row.lost_reason_id
              ? { data: null, error: { code: "23514", message: 'violates check constraint "leads_lost_has_reason"' } }
              : { data: [{ id: "lead-1" }], error: null },
        };
        return chain;
      },
    }),
  };
}

vi.mock("@/lib/auth/account", () => ({
  requireRole: vi.fn(async () => ({ supabase: fakeSupabase() })),
  toErrorResponse: vi.fn(() => Response.json({ error: "auth failed" }, { status: 403 })),
}));

import { PATCH } from "./route";

const patch = (body: unknown) =>
  PATCH(new Request("http://test/api/admissions/leads/lead-1", { method: "PATCH", body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: "lead-1" }),
  });

beforeEach(() => {
  h.updates.length = 0;
});

describe("PATCH /api/admissions/leads/[id]", () => {
  it("refuses Lost without a reason with 422", async () => {
    const res = await patch({ exit: "lost" });
    expect(res.status).toBe(422);
  });

  it("closes as Lost with a reason", async () => {
    const res = await patch({ exit: "lost", lost_reason_id: "reason-1" });
    expect(res.status).toBe(200);
    expect(h.updates[0]).toMatchObject({ exit: "lost", lost_reason_id: "reason-1" });
  });

  it("drops a reason sent with Dormant", async () => {
    const res = await patch({ exit: "dormant", lost_reason_id: "reason-1" });
    expect(res.status).toBe(200);
    expect(h.updates[0]).toMatchObject({ exit: "dormant", lost_reason_id: null });
  });

  it("moves through move_lead and passes its refusal on as 422", async () => {
    h.rpc.mockResolvedValueOnce({ error: { code: "23514", message: "An open lead can only move to a stage of its own pipeline" } });
    const res = await patch({ stage_id: "stage-9" });
    expect(h.rpc).toHaveBeenCalledWith("move_lead", { p_lead_id: "lead-1", p_stage_id: "stage-9" });
    expect(res.status).toBe(422);
  });

  it("answers 400 to a body that asks for nothing", async () => {
    expect((await patch({})).status).toBe(400);
  });
});
