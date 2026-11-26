// M4 (#67) · The website form is public: bad input stops here, before the database; each IP gets a few tries; the
// account is the server's, never the one a request names. intake() itself is tested in tests/db/m4-intake.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ calls: [] as unknown[][] }));

vi.mock("@/lib/flows/admin-client", () => ({ supabaseAdmin: () => ({}) }));
vi.mock("@/admissions/lib/intake", async (orig) => ({
  ...(await orig<typeof import("@/admissions/lib/intake")>()),
  intake: async (...args: unknown[]) => (h.calls.push(args), { contact_id: "c", lead_id: "l", created: true }),
}));

import { __resetRateLimitForTests } from "@/lib/rate-limit";
import { POST } from "./route";

let ip = 0;
const post = (body: unknown, { json = true, from = `10.0.0.${++ip}` } = {}) =>
  POST(
    new Request("http://localhost/api/admissions/intake/website", {
      method: "POST",
      headers: { "content-type": json ? "application/json" : "application/x-www-form-urlencoded", "x-real-ip": from },
      body: typeof body === "string" ? body : json ? JSON.stringify(body) : new URLSearchParams(body as Record<string, string>).toString(),
    }),
  );
const good = { phone: "98765 43210", parent: "Sunita Patil", child: "Aarav", dob: "14/03/2022", area: "Baner" };

beforeEach(() => {
  h.calls = [];
  __resetRateLimitForTests();
  vi.stubEnv("ADMISSIONS_ACCOUNT_ID", "acc-server");
});
afterEach(() => vi.unstubAllEnvs());

describe("the public form rejects bad input", () => {
  it.each([
    ["a short phone", { ...good, phone: "98765 12" }],
    ["no phone", { ...good, phone: undefined }],
    ["no parent", { ...good, parent: "  " }],
    ["a date that isn't one", { ...good, dob: "31/02/2022" }],
    ["a field that isn't text", { ...good, child: { $ne: "" } }],
    ["a name too long", { ...good, parent: "x".repeat(81) }],
  ])("%s → 400, nothing written", async (_, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(h.calls).toHaveLength(0);
  });
  it("broken JSON → 400", async () => expect((await post("{not json")).status).toBe(400));
  it("an oversized body → 413", async () => expect((await post({ ...good, area: "x".repeat(5000) })).status).toBe(413));
});

describe("a good enquiry", () => {
  it("opens through intake with the server's account and the website source, never the request's account", async () => {
    const res = await post({ ...good, account_id: "acc-attacker" });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true }); // no lead id, no "already with us": nothing to probe
    expect(h.calls).toHaveLength(1);
    const [, accountId, input] = h.calls[0] as [unknown, string, Record<string, unknown>];
    expect(accountId).toBe("acc-server");
    expect(input).toMatchObject({ phone: "98765 43210", parent: "Sunita Patil", child: "Aarav", dob: "2022-03-14", sources: ["website"] });
  });
  it("takes a plain HTML form post", async () => {
    expect((await post(good, { json: false })).status).toBe(201);
    expect(h.calls).toHaveLength(1);
  });
  it("is closed when the server has no account set", async () => {
    vi.stubEnv("ADMISSIONS_ACCOUNT_ID", "");
    expect((await post(good)).status).toBe(503);
  });
});

describe("spam checks and known families (#91 review)", () => {
  it("a filled honeypot gets the same 201 and writes nothing", async () => {
    const res = await post({ ...good, website_url: "http://spam.example" }, { json: false });
    expect([res.status, await res.json()]).toEqual([201, { ok: true }]);
    expect(h.calls).toHaveLength(0);
  });
  it("a form sent under 3 seconds after it was shown gets the same 201 and writes nothing", async () => {
    expect((await post({ ...good, started_at: String(Date.now() - 1_000) })).status).toBe(201);
    expect((await post({ ...good, started_at: "soon" })).status).toBe(201);
    expect(h.calls).toHaveLength(0);
  });
  it("a form filled at human speed goes through", async () => {
    expect((await post({ ...good, website_url: "", started_at: String(Date.now() - 20_000) }, { json: false })).status).toBe(201);
    expect(h.calls).toHaveLength(1);
  });
  it("never fills a known family's fields, only notes them", async () => {
    await post(good);
    expect((h.calls[0] as [unknown, string, Record<string, unknown>])[2]).toMatchObject({ fill: false });
  });
});

describe("the public form is rate-limited", () => {
  it("five tries per IP in ten minutes, then 429; another IP is unaffected", async () => {
    for (let i = 0; i < 5; i++) expect((await post(good, { from: "203.0.113.9" })).status).toBe(201);
    expect((await post(good, { from: "203.0.113.9" })).status).toBe(429);
    expect((await post({ ...good, phone: "1" }, { from: "203.0.113.9" })).status).toBe(429); // bad input counts too
    expect((await post(good, { from: "203.0.113.10" })).status).toBe(201);
  });
});
