// #63 · globals.css declares the platform's layer order; the viewport says the page is light only.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

describe("globals.css layer order", () => {
  const globals = read("src/app/globals.css");

  it("declares the platform's layer order before importing tailwind", () => {
    const layers = globals.indexOf("@layer theme, tokens, base, components, utilities;");
    expect(layers, "layer order line missing").toBeGreaterThanOrEqual(0);
    expect(layers).toBeLessThan(globals.indexOf('@import "tailwindcss";'));
  });
});

describe("viewport", () => {
  it("has colorScheme 'light'", () => {
    expect(read("src/app/layout.tsx")).toMatch(/colorScheme:\s*["']light["']/);
  });
});
