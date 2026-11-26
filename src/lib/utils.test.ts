// #63 · cn() knows the type-scale utilities (globals.css @utility text-*) are font sizes, not text colours.
import { describe, expect, it } from "vitest";

import { cn } from "./utils";

describe("cn() and the type scale", () => {
  it.each(["text-title-page", "text-body", "text-caption"])("keeps %s next to a text colour", (size) => {
    expect(cn(size, "text-primary").split(" ").sort()).toEqual([size, "text-primary"].sort());
  });

  it("lets a later type-scale size replace an earlier one", () => {
    expect(cn("text-body", "text-caption")).toBe("text-caption");
  });
});
