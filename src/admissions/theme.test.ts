// #7 · The Cornerstone theme: globals.css loads design/tokens.css and points wacrm's shadcn names at its tokens; light is held.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const globals = read("src/app/globals.css");
const tokens = new Set(read("design/tokens.css").match(/--[\w-]+(?=\s*:)/g));

// The value of `--name: …;` declared outside `@theme` blocks (the bridge), or undefined.
function bridged(name: string): string | undefined {
  const outsideTheme = globals.replace(/@theme[^{]*\{[^}]*\}/g, "");
  return outsideTheme.match(new RegExp(`(?:^|[\\s;{])${name}\\s*:\\s*([^;]+);`))?.[1].trim();
}

describe("globals.css loads the Cornerstone tokens", () => {
  it("imports design/tokens.css into the tokens layer", () => {
    expect(globals).toMatch(/@import\s+["']\.\.\/\.\.\/design\/tokens\.css["']\s+layer\(tokens\)/);
  });

  it("has no per-theme or per-mode blocks left", () => {
    expect(globals).not.toMatch(/html\[data-theme=/);
    expect(globals).not.toMatch(/html\[data-mode=/);
  });

  it.each(["--background", "--foreground", "--primary", "--card", "--sidebar", "--border", "--ring", "--radius"])(
    "%s resolves to a Cornerstone token",
    (name) => {
      const value = bridged(name);
      expect(value, `${name} is not declared in globals.css`).toBeDefined();
      const used = value!.match(/var\((--[\w-]+)/g)?.map((v) => v.slice(4)) ?? [];
      expect(used.length, `${name}: ${value} names no token`).toBeGreaterThan(0);
      for (const t of used) expect(tokens.has(t), `${name} uses ${t}, which design/tokens.css does not define`).toBe(true);
    },
  );
});

describe("light is held and the theme picker is gone", () => {
  const layout = read("src/app/layout.tsx");

  it('puts data-scheme="light" on <html> and drops data-theme', () => {
    expect(layout).toMatch(/data-scheme="light"/);
    expect(layout).not.toMatch(/data-theme=/);
  });

  it("removes the mode toggle and its use in the header", () => {
    expect(existsSync(new URL("../components/layout/mode-toggle.tsx", import.meta.url))).toBe(false);
    expect(read("src/components/layout/header.tsx")).not.toMatch(/ModeToggle|mode-toggle/);
  });
});
