// #70 · The settings API: only an owner or admin can change a setting; bad values stop at the boundary, before the DB.
// The real requireRole runs against a fake Supabase client, so the role comes from the caller's profile as in production.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  role: "admin",
  stored: null as Record<string, unknown> | null,
  writes: [] as { op: string; row: unknown }[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
    from: (table: string) => {
      let op = "select";
      let row: unknown = null;
      const result = () => {
        if (table === "profiles") return { account_id: "acc-1", account_role: h.role };
        if (table === "accounts") return { id: "acc-1", name: "Cornerstone" };
        if (table === "message_templates") return [];
        if (op === "select") return h.stored;
        return { id: "s-1", ...(row as object) };
      };
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order", "limit", "in"]) b[m] = () => b;
      b.insert = (r: unknown) => ((op = "insert"), (row = r), h.writes.push({ op, row: r }), b);
      b.update = (r: unknown) => ((op = "update"), (row = r), h.writes.push({ op, row: r }), b);
      b.single = b.maybeSingle = async () => ({ data: result(), error: null });
      b.then = (resolve: (v: unknown) => void) => resolve({ data: result(), error: null });
      return b;
    },
  }),
}));

import { POST } from "./route";
import { PATCH } from "./[id]/route";

const ID = "3f2b8c1e-9a4d-4e2f-b6a1-0c9d8e7f6a5b";
const req = (body: unknown, method = "POST") =>
  new Request("http://localhost/api/admissions/settings", { method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
const patch = (body: unknown) => PATCH(req(body, "PATCH"), { params: Promise.resolve({ id: ID }) });

beforeEach(() => {
  h.role = "admin";
  h.writes = [];
  h.stored = { id: ID, kind: "alert", key: "untouched", label: "Untouched", value: { threshold: 24 }, active: true, sort_order: 0 };
});

describe("permission", () => {
  it.each(["agent", "viewer"])("refuses a %s adding a setting (403) and writes nothing", async (role) => {
    h.role = role;
    const res = await POST(req({ kind: "source", label: "Gate QR" }));
    expect(res.status).toBe(403);
    expect(h.writes).toHaveLength(0);
  });

  it("refuses an agent changing a setting (403) and writes nothing", async () => {
    h.role = "agent";
    const res = await patch({ value: { threshold: 48 } });
    expect(res.status).toBe(403);
    expect(h.writes).toHaveLength(0);
  });

  it("lets an admin add a source, keyed by its tag", async () => {
    const res = await POST(req({ kind: "source", label: "Gate QR", key: "gate" }));
    expect(res.status).toBe(201);
    expect(h.writes).toEqual([{ op: "insert", row: expect.objectContaining({ kind: "source", key: "gate", label: "Gate QR", account_id: "acc-1" }) }]);
  });

  it("lets an owner switch a setting off", async () => {
    h.role = "owner";
    const res = await patch({ active: false });
    expect(res.status).toBe(200);
    expect(h.writes).toEqual([{ op: "update", row: { active: false } }]);
  });
});

describe("validation at the boundary", () => {
  it.each([
    [{ kind: "nonsense", label: "x" }, "Unknown kind of setting."],
    [{ kind: "source", label: " " }, "Enter a name."],
    [{ kind: "alert", key: "untouched", label: "Untouched", value: { threshold: 0 } }, "Enter 1 to 168 hours."],
    [{ kind: "follow_up_rule", label: "r", value: { stage: "Enquiry", days: 2, action: "send_template" } }, "Pick a template."],
  ])("POST %j → 400", async (body, error) => {
    const res = await POST(req(body));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error });
    expect(h.writes).toHaveLength(0);
  });

  it("PATCH checks the value against the stored kind and key", async () => {
    const res = await patch({ value: { threshold: 500 } });
    expect(res.status).toBe(400);
    expect(h.writes).toHaveLength(0);
  });

  it("PATCH refuses a non-boolean on/off", async () => {
    expect((await patch({ active: "no" })).status).toBe(400);
  });

  it("a rule whose template is not approved saves switched off", async () => {
    const res = await POST(req({ kind: "follow_up_rule", label: "r", value: { stage: "Enquiry", days: 1, action: "send_template", template: "nudge" } }));
    expect(res.status).toBe(201);
    expect((await res.json()).templateNotApproved).toBe(true);
    expect(h.writes[0].row).toMatchObject({ active: false, key: "enquiry_day_1_send_template" });
  });
});
