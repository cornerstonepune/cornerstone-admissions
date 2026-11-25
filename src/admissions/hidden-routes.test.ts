// Hidden v1 screens answer 404 (PROJECT.md M1 G1.2); an invited sign-up still works.
import { describe, expect, it } from "vitest";
import { isHiddenRoute } from "./hidden-routes";

const hidden = (url: string) => {
  const u = new URL(url, "https://app.test");
  return isHiddenRoute(u.pathname, u.searchParams);
};

describe("isHiddenRoute", () => {
  it.each(["/broadcasts", "/broadcasts/new", "/broadcasts/abc", "/agents", "/agents/x", "/signup"])("hides %s", (p) =>
    expect(hidden(p)).toBe(true),
  );

  it.each(["/login", "/join/abc", "/dashboard", "/inbox", "/settings", "/forgot-password", "/reset-password"])(
    "keeps %s",
    (p) => expect(hidden(p)).toBe(false),
  );

  it("keeps sign-up open for an invited person", () => expect(hidden("/signup?invite=tok123")).toBe(false));
});
