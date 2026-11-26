// The Calendar's read (ADR 0040): a bounded range in India time, only meetings that still stand.
import { describe, expect, it, vi } from "vitest";

const requireRole = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/account", () => ({ requireRole, toErrorResponse: vi.fn() }));

import { GET } from "./route";

const get = (q: string) => GET(new Request(`http://test/api/admissions/calendar?${q}`));

function fakeDb() {
  const calls: [string, ...unknown[]][] = [];
  const rows: Record<string, unknown[]> = {
    visits: [{ id: "v-1" }],
    lead_activity: [{ id: "c-1", lead_id: "l-1", due_at: "2026-12-01T05:30:00Z", done_at: null, outcome: null, notes: "fees", lead: null }],
  };
  const db = {
    from(table: string) {
      calls.push(["from", table]);
      const q: Record<string, unknown> = {};
      for (const m of ["select", "gte", "lt", "not", "eq", "or"]) q[m] = (...a: unknown[]) => (calls.push([m, ...a]), q);
      q.order = async () => ({ data: rows[table], error: null });
      return q;
    },
  };
  return { db, calls };
}

describe("GET /api/admissions/calendar", () => {
  it("reads visits from India midnight to India midnight, without cancelled or rescheduled ones", async () => {
    const { db, calls } = fakeDb();
    requireRole.mockResolvedValueOnce({ supabase: db });
    const res = await get("from=2026-11-30&to=2027-01-11");
    expect(res.status).toBe(200);
    const { meetings } = await res.json();
    expect(meetings[0]).toEqual({ id: "v-1" });
    expect(meetings[1]).toMatchObject({ id: "c-1", kind: "call", status: "to_call", starts_at: "2026-12-01T05:30:00Z", note: "fees" });
    const [a, b] = ["2026-11-29T18:30:00.000Z", "2027-01-10T18:30:00.000Z"];
    expect(calls).toContainEqual(["eq", "kind", "call_task"]);
    expect(calls).toContainEqual(["or", `and(done_at.is.null,due_at.gte.${a},due_at.lt.${b}),and(done_at.gte.${a},done_at.lt.${b})`]);
    expect(calls).toContainEqual(["from", "visits"]);
    expect(calls).toContainEqual(["gte", "starts_at", "2026-11-29T18:30:00.000Z"]);
    expect(calls).toContainEqual(["lt", "starts_at", "2027-01-10T18:30:00.000Z"]);
    expect(calls).toContainEqual(["not", "status", "in", "(cancelled,rescheduled)"]);
  });

  it("refuses a missing, malformed, backwards or too-long range before reading anything", async () => {
    requireRole.mockClear();
    for (const q of ["", "from=2026-11-30", "from=30-11-2026&to=2026-12-30", "from=2026-12-30&to=2026-11-30", "from=2026-01-01&to=2026-12-31"]) {
      expect((await get(q)).status).toBe(400);
    }
    expect(requireRole).not.toHaveBeenCalled();
  });
});
