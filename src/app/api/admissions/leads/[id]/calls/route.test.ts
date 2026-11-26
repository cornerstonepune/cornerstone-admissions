// A call logged against a lead id that isn't a uuid gets 400, not a 500 from Postgres (22P02). A call made closes the
// lead's open call tasks (a rule's, a WhatsApp call-back request's), so they leave the Today list (ADR 0035).
import { describe, expect, it, vi } from "vitest";

import { createFakeDb } from "@/lib/flows/fake-db.test-helper";

const requireRole = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/account", () => ({ requireRole, toErrorResponse: vi.fn() }));

import { POST } from "./route";

const LEAD = "11111111-1111-4111-8111-111111111111";
const log = (body: unknown) =>
  POST(new Request("http://test", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id: LEAD }) });

describe("logging a call", () => {
  it("closes the lead's open call tasks with the outcome and adds no second row", async () => {
    const tables = {
      lead_activity: [
        { id: "t1", lead_id: LEAD, kind: "call_task", done_at: null, notes: "Asked for a call back on WhatsApp." },
        { id: "t2", lead_id: "other-lead", kind: "call_task", done_at: null },
        { id: "t3", lead_id: LEAD, kind: "call_task", done_at: "2026-11-01T00:00:00Z", outcome: "Talked" },
      ],
    };
    requireRole.mockResolvedValueOnce({ supabase: createFakeDb(tables), accountId: "acct-1", userId: "u-1" });
    expect((await log({ outcome: "Talked", notes: "Visit on Saturday" })).status).toBe(201);
    expect(tables.lead_activity).toHaveLength(3);
    expect(tables.lead_activity[0]).toMatchObject({ outcome: "Talked", assigned_to: "u-1", notes: "Visit on Saturday" });
    expect(tables.lead_activity[0].done_at).toBeTruthy();
    expect(tables.lead_activity[1].done_at).toBeNull(); // another lead's task is untouched
  });

  it("with no open task, logs the call as a new done task", async () => {
    const tables = { lead_activity: [] as Record<string, unknown>[] };
    requireRole.mockResolvedValueOnce({ supabase: createFakeDb(tables), accountId: "acct-1", userId: "u-1" });
    expect((await log({ outcome: "Talked" })).status).toBe(201);
    expect(tables.lead_activity).toEqual([expect.objectContaining({ lead_id: LEAD, kind: "call_task", outcome: "Talked" })]);
    expect(tables.lead_activity[0].done_at).toBeTruthy();
  });
});

describe("POST /api/admissions/leads/[id]/calls", () => {
  it("refuses a malformed lead id before touching the database", async () => {
    const res = await POST(
      new Request("http://test/api/admissions/leads/x/calls", { method: "POST", body: JSON.stringify({ outcome: "Talked" }) }),
      { params: Promise.resolve({ id: "not-a-uuid" }) },
    );
    expect(res.status).toBe(400);
    expect(requireRole).not.toHaveBeenCalled();
  });
});
