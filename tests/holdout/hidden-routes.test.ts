// Hidden: hidden v1 screens through the real middleware, and the edges of isHiddenRoute (M1 G1.2).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

let mockUser: { id: string } | null = null;

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: mockUser } }) } }),
}));

const { middleware } = await import("../../src/middleware");
const { isHiddenRoute } = await import("../../src/admissions/hidden-routes");

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  mockUser = null;
});

const status = async (path: string) => (await middleware(new NextRequest(`https://app.test${path}`))).status;

describe("middleware hides v1 screens (hidden)", () => {
  it.each(["/broadcasts", "/broadcasts/new", "/agents", "/signup"])("answers 404 for %s, signed out", async (p) => {
    expect(await status(p)).toBe(404);
  });

  it.each(["/broadcasts/abc", "/agents", "/signup"])("answers 404 for %s, signed in", async (p) => {
    mockUser = { id: "u1" };
    expect(await status(p)).toBe(404);
  });

  it("still sends a signed-in invited person from /signup to /join", async () => {
    mockUser = { id: "u1" };
    const res = await middleware(new NextRequest("https://app.test/signup?invite=tok123"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/join/tok123");
  });

  it("lets a signed-out invited person reach /signup", async () => {
    expect(await status("/signup?invite=tok123")).toBe(200);
  });

  it("still sends a signed-out person from /inbox to /login", async () => {
    expect(await status("/inbox")).toBe(307);
  });
});

describe("isHiddenRoute edges (hidden)", () => {
  const hidden = (url: string) => {
    const u = new URL(url, "https://app.test");
    return isHiddenRoute(u.pathname, u.searchParams);
  };

  it("matches whole path segments only", () => {
    expect(hidden("/agentsx")).toBe(false);
    expect(hidden("/broadcastsfoo/1")).toBe(false);
    expect(hidden("/signups")).toBe(false);
  });

  it("treats an empty invite as no invite", () => expect(hidden("/signup?invite=")).toBe(true));

  it("hides /signup/ sub-paths without an invite", () => expect(hidden("/signup/x")).toBe(true));
});
