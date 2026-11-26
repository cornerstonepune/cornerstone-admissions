// #71 review · POST /api/admissions/import: admin+ only, a byte cap on the body, and every reported row names its file line.
// The real requireRole runs against a fake Supabase client, so the role comes from the caller's profile as in production.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  role: "admin",
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
    rpc: h.rpc,
    from: (table: string) => {
      const result = () => {
        if (table === "profiles") return { account_id: "acc-1", account_role: h.role };
        if (table === "accounts") return { id: "acc-1", name: "Cornerstone" };
        if (table === "admissions_settings") return [{ id: "c-neev", kind: "campus", label: "Neev" }];
        if (table === "pipeline_stages") return ["Enquiry", "Visited", "Admitted"].map((name) => ({ id: `st-${name}`, name }));
        return null;
      };
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order", "limit", "in"]) b[m] = () => b;
      b.single = b.maybeSingle = async () => ({ data: result(), error: null });
      b.then = (resolve: (v: unknown) => void) => resolve({ data: result(), error: null });
      return b;
    },
  }),
}));

import { POST } from "./route";

const post = (body: BodyInit, headers: Record<string, string> = {}) =>
  POST(new Request("http://localhost/api/admissions/import", { method: "POST", body, headers: { "Content-Type": "text/csv", ...headers } }));

beforeEach(() => {
  h.role = "admin";
  h.rpc.mockReset();
});

describe("POST /api/admissions/import", () => {
  it.each(["agent", "viewer"])("refuses a %s (403) and imports nothing", async (role) => {
    h.role = role;
    const res = await post("phone,child\n9876543210,Riya");
    expect(res.status).toBe(403);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("refuses a body over 1 MB by its Content-Length (413) before reading it", async () => {
    const res = await post("phone,child\n", { "Content-Length": "1000001" });
    expect(res.status).toBe(413);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("counts bytes, not characters, when no length is declared (413)", async () => {
    const body = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode("phone,child\n" + "é".repeat(600_000))); // 600k characters, 1.2 MB
        c.close();
      },
    });
    const res = await POST(new Request("http://localhost/api/admissions/import", { method: "POST", body, duplex: "half" } as RequestInit));
    expect(res.status).toBe(413);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("names each bad row by its file line, whether the sheet or the database refused it", async () => {
    h.rpc.mockResolvedValue({ data: [{ status: "imported" }, { status: "failed", error: "No access" }, { status: "duplicate" }], error: null });
    const csv = ["Phone,Child,Campus", "9876543210,Riya,Neev", "123,Bad phone,", "9876543211,Dev,", "9876543212,Gone,Gurukul", "9876543213,Ann,"].join("\n");
    const res = await post(csv);
    expect(res.status).toBe(200);
    const sent = h.rpc.mock.calls[0][1].p_rows as { phone: string }[];
    expect(sent.map((r) => r.phone)).toEqual(["919876543210", "919876543211", "919876543213"]);
    const json = await res.json();
    expect(json).toMatchObject({ imported: 1, skipped: 1, failed: 3 });
    expect(json.failedDetails.map((d: { reason: string }) => d.reason)).toEqual([
      "Line 3: No valid phone number (10 digits, or +country code).",
      'Line 5: Unknown campus "Gurukul". Add it in Admissions settings first.',
      "Line 4: No access",
    ]);
  });
});
