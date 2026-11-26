// The Calendar's read (ADR 0040): a bounded range in India time, only meetings that still stand.
import { describe, expect, it, vi } from "vitest";

const requireRole = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/account", () => ({ requireRole, toErrorResponse: vi.fn() }));

import { GET } from "./route";

const get = (q: string) => GET(new Request(`http://test/api/admissions/calendar?${q}`));

function fakeDb() {
  const calls: [string, ...unknown[]][] = [];
  const q: Record<string, unknown> = {};
  for (const m of ["from", "select", "gte", "lt", "not"]) q[m] = (...a: unknown[]) => (calls.push([m, ...a]), q);
  q.order = async () => ({ data: [{ id: "v-1" }], error: null });
  return { db: q, calls };
}

describe("GET /api/admissions/calendar", () => {
  it("reads visits from India midnight to India midnight, without cancelled or rescheduled ones", async () => {
    const { db, calls } = fakeDb();
    requireRole.mockResolvedValueOnce({ supabase: db });
    const res = await get("from=2026-11-30&to=2027-01-11");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ meetings: [{ id: "v-1" }] });
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
