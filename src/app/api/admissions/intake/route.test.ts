// M4 (#67, #91 review) · Staff quick-add saves even when Walk-in / Phone call aren't set up or are switched off: the
// lead's source is left empty. A source that isn't one of the two is still refused. intake() is tested in tests/db.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ calls: [] as unknown[][], updates: [] as unknown[][] }));

vi.mock("@/lib/auth/account", () => ({
  requireRole: async () => ({
    userId: "u1",
    accountId: "acc-1",
    supabase: {
      from: (table: string) => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { full_name: "Ravi K." } }) }) }),
        update: (row: unknown) => ({
          eq: (_c: string, id: string) => ({ is: async (col: string) => (h.updates.push([table, row, id, col]), { error: null }) }),
        }),
      }),
    },
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
  h.updates = [];
  __resetRateLimitForTests();
});

describe("quick-add email (ADR 0038)", () => {
  it("fills the parent's email only where none is on file", async () => {
    expect((await post({ ...family, email: " Sunita@Example.com " })).status).toBe(201);
    expect(h.updates).toEqual([["contacts", { email: "sunita@example.com" }, "c", "email"]]);
  });
  it("refuses a malformed email and saves nothing", async () => {
    expect((await post({ ...family, email: "sunita at example" })).status).toBe(400);
    expect(h.calls).toHaveLength(0);
  });
  it("no email, no update", async () => {
    await post(family);
    expect(h.updates).toHaveLength(0);
  });
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
