// M4 (#67, #91 review) · Staff quick-add saves even when Walk-in / Phone call aren't set up or are switched off: the
// lead's source is left empty. A source that isn't one of the two is still refused. intake() is tested in tests/db.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ calls: [] as unknown[][] }));

vi.mock("@/lib/auth/account", () => ({
  requireRole: async () => ({
    userId: "u1",
    accountId: "acc-1",
    supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { full_name: "Ravi K." } }) }) }) }) },
  }),
  toErrorResponse: () => new Response(null, { status: 401 }),
}));
vi.mock("@/admissions/lib/intake", async (orig) => ({
  ...(await orig<typeof import("@/admissions/lib/intake")>()),
  intake: async (...args: unknown[]) => (h.calls.push(args), { contact_id: "c", lead_id: "l", created: true }),
}));

import { __resetRateLimitForTests } from "@/lib/rate-limit";
import { POST } from "./route";

const post = (body: Record<string, unknown>) =>
  POST(new Request("http://localhost/api/admissions/intake", { method: "POST", body: JSON.stringify(body) }));
const family = { phone: "98765 43210", parent: "Sunita Patil", child: "Aarav" };

beforeEach(() => {
  h.calls = [];
  __resetRateLimitForTests();
});

describe("quick-add source", () => {
  it.each([["missing", {}], ["empty", { source: "" }]])("%s → saved with no source", async (_, extra) => {
    expect((await post({ ...family, ...extra })).status).toBe(201);
    expect((h.calls[0] as [unknown, string, Record<string, unknown>])[2]).toMatchObject({ sources: [] });
  });
  it("a chosen source is passed on", async () => {
    await post({ ...family, source: "walk_in" });
    expect((h.calls[0] as [unknown, string, Record<string, unknown>])[2]).toMatchObject({ sources: ["walk_in"] });
  });
  it("anything else is refused", async () => {
    expect((await post({ ...family, source: "instagram" })).status).toBe(400);
    expect(h.calls).toHaveLength(0);
  });
});
