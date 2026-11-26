// A call logged against a lead id that isn't a uuid gets 400, not a 500 from Postgres (22P02).
import { describe, expect, it, vi } from "vitest";

const requireRole = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/account", () => ({ requireRole, toErrorResponse: vi.fn() }));

import { POST } from "./route";

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
