// ADR 0038: Edit mode (PATCH { fields }) and Delete lead (DELETE, admin only). The fake database answers like
// PostgREST with RLS on; tests/db/lead-delete.test.ts proves the real policy.
import { beforeEach, describe, expect, it, vi } from "vitest";

const LEAD = "11111111-1111-4111-8111-111111111111";
const DEAL = "33333333-3333-4333-8333-333333333333";
const CONTACT = "44444444-4444-4444-8444-444444444444";
const CAMPUS = "55555555-5555-4555-8555-555555555555";
const SOURCE = "66666666-6666-4666-8666-666666666666";

const h = vi.hoisted(() => ({
  role: "admin" as "viewer" | "agent" | "admin",
  writes: [] as { table: string; op: string; row?: Record<string, unknown>; id?: string }[],
  updateError: null as null | { code: string; message: string },
  settings: [] as { id: string; kind: string }[],
}));

function fakeSupabase() {
  return {
    from: (table: string) => ({
      select: () => {
        const chain = {
          eq: () => chain,
          in: async () => ({ data: h.settings, error: null }),
          maybeSingle: async () => ({ data: { deal_id: DEAL, contact_id: CONTACT }, error: null }),
        };
        return chain;
      },
      update: (row: Record<string, unknown>) => ({
        eq: (_c: string, id: string) => ({
          select: async () => {
            h.writes.push({ table, op: "update", row, id });
            return table === "contacts" && h.updateError
              ? { data: null, error: h.updateError }
              : { data: [{ id }], error: null };
          },
        }),
      }),
      delete: () => ({
        eq: (_c: string, id: string) => ({
          select: async () => {
            h.writes.push({ table, op: "delete", id });
            return { data: [{ id }], error: null };
          },
        }),
      }),
    }),
  };
}

const ORDER = ["viewer", "agent", "admin"];
vi.mock("@/lib/auth/account", () => ({
  requireRole: vi.fn(async (min: string) => {
    if (ORDER.indexOf(h.role) < ORDER.indexOf(min)) throw new Error("Insufficient role");
    return { supabase: fakeSupabase() };
  }),
  toErrorResponse: vi.fn(() => Response.json({ error: "Insufficient role" }, { status: 403 })),
}));

import { DELETE, PATCH } from "./route";

const ctx = { params: Promise.resolve({ id: LEAD }) };
const edit = (fields: unknown) =>
  PATCH(new Request(`http://test/api/admissions/leads/${LEAD}`, { method: "PATCH", body: JSON.stringify({ fields }) }), ctx);
const del = () => DELETE(new Request(`http://test/api/admissions/leads/${LEAD}`, { method: "DELETE" }), ctx);

beforeEach(() => {
  h.role = "admin";
  h.writes.length = 0;
  h.updateError = null;
  h.settings = [
    { id: CAMPUS, kind: "campus" },
    { id: SOURCE, kind: "source" },
  ];
});

describe("DELETE /api/admissions/leads/[id]", () => {
  it("lets an admin delete the lead through its deal", async () => {
    const res = await del();
    expect(res.status).toBe(200);
    expect(h.writes).toEqual([{ table: "deals", op: "delete", id: DEAL }]);
  });

  it("refuses an agent and a viewer, and deletes nothing", async () => {
    for (const role of ["agent", "viewer"] as const) {
      h.role = role;
      expect((await del()).status).toBe(403);
    }
    expect(h.writes).toHaveLength(0);
  });

  it("refuses a malformed id", async () => {
    const res = await DELETE(new Request("http://test", { method: "DELETE" }), { params: Promise.resolve({ id: "x" }) });
    expect(res.status).toBe(400);
  });
});

describe("PATCH { fields } — Edit mode", () => {
  it("splits the details over contact, lead and deal, contact first", async () => {
    h.role = "agent";
    const res = await edit({
      child_name: " Aarav ",
      child_dob: "2021-04-02",
      grade: "Nursery",
      campus_id: CAMPUS,
      source_id: SOURCE,
      area: "Baner",
      notes: "",
      parent_name: "Priya",
      phone: "98765 43210",
      email: "Priya@Example.com",
    });
    expect(res.status).toBe(200);
    expect(h.writes).toEqual([
      { table: "contacts", op: "update", id: CONTACT, row: { name: "Priya", phone: "919876543210", email: "priya@example.com" } },
      {
        table: "leads",
        op: "update",
        id: LEAD,
        row: { child_name: "Aarav", child_dob: "2021-04-02", grade: "Nursery", campus_id: CAMPUS, source_id: SOURCE, area: "Baner" },
      },
      { table: "deals", op: "update", id: DEAL, row: { notes: null } },
    ]);
  });

  it("refuses a viewer", async () => {
    h.role = "viewer";
    expect((await edit({ child_name: "A" })).status).toBe(403);
    expect(h.writes).toHaveLength(0);
  });

  it("answers a phone another family has with a clear 409, not a 500", async () => {
    h.updateError = { code: "23505", message: 'duplicate key value violates unique constraint "idx_contacts_account_phone_normalized"' };
    const res = await edit({ phone: "9876543210" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/already has this phone number/);
  });

  it("refuses a campus that isn't one of this account's campuses", async () => {
    h.settings = [{ id: CAMPUS, kind: "source" }]; // right id, wrong kind; another account's id is not found at all
    expect((await edit({ campus_id: CAMPUS })).status).toBe(422);
    expect(h.writes).toHaveLength(0);
  });

  it.each([
    [{ email: "not-an-email" }, /valid email/],
    [{ phone: "12345" }, /10-digit/],
    [{ phone: "" }, /10-digit/],
    [{ child_dob: "2021-02-30" }, /date of birth/],
    [{ child_dob: "2999-01-01" }, /date of birth/],
    [{ campus_id: "gurukul" }, /campus/],
    [{ child_name: "x".repeat(81) }, /80 characters/],
    [{ grade: 5 }, /must be text/],
    [{ account_id: LEAD }, /Unknown field/],
    [{ constructor: "x" }, /Unknown field/],
    [{ toString: "x" }, /Unknown field/],
    [[], /details/],
  ])("refuses %j with 400", async (fields, message) => {
    const res = await edit(fields);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(message);
    expect(h.writes).toHaveLength(0);
  });
});
