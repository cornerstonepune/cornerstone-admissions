// Hidden #7: every shadcn name wacrm reads lands on a token, no raw colour survives, fonts and breakpoint are the platform's.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const globals = read("src/app/globals.css");
const layout = read("src/app/layout.tsx");
const tokens = new Set(read("design/tokens.css").match(/--[\w-]+(?=\s*:)/g));
const outsideTheme = globals.replace(/@theme[^{]*\{[^}]*\}/g, "");

const declared = (name: string) =>
  outsideTheme.match(new RegExp(`(?:^|[\\s;{])${name}\\s*:\\s*([^;]+);`))?.[1].trim();

// Follows var() through other bridge names until only tokens are left; fails on anything else.
function resolvesToTokens(name: string, seen = new Set<string>()): boolean {
  if (tokens.has(name)) return true;
  if (seen.has(name)) return false;
  seen.add(name);
  const value = declared(name);
  if (!value) return false;
  const used = value.match(/var\((--[\w-]+)/g)?.map((v) => v.slice(4)) ?? [];
  return used.length > 0 && used.every((u) => resolvesToTokens(u, seen));
}

// Every name wacrm's `@theme inline` block and components read (except next/font's own variables).
const WACRM_NAMES = [
  "--background", "--foreground", "--card", "--card-2", "--card-foreground", "--popover", "--popover-foreground",
  "--primary", "--primary-foreground", "--primary-hover", "--primary-soft", "--primary-soft-2",
  "--secondary", "--secondary-foreground", "--muted", "--muted-foreground", "--accent", "--accent-foreground",
  "--destructive", "--border", "--input", "--ring", "--radius",
  "--sidebar", "--sidebar-foreground", "--sidebar-primary", "--sidebar-primary-foreground",
  "--sidebar-accent", "--sidebar-accent-foreground", "--sidebar-border", "--sidebar-ring",
  "--chart-1", "--chart-2", "--chart-3", "--chart-4", "--chart-5",
  "--status-good", "--status-warning", "--status-serious", "--status-critical",
];

describe("the bridge (hidden)", () => {
  it.each(WACRM_NAMES)("%s resolves, through the bridge, only to tokens", (name) => {
    expect(resolvesToTokens(name), `${name}: ${declared(name) ?? "not declared"}`).toBe(true);
  });

  it("writes no raw colour anywhere in globals.css", () => {
    expect(globals).not.toMatch(/oklch\(|\brgba?\(|\bhsla?\(|#[0-9a-fA-F]{3,8}\b/);
  });

  it("keeps the status colours on the state tokens (late is red, ok is green)", () => {
    expect(resolvesToTokens("--status-critical")).toBe(true);
    expect(declared("--status-critical")).toMatch(/--state-late/);
    expect(declared("--status-good")).toMatch(/--state-ok/);
    expect(declared("--destructive")).toMatch(/--state-late/);
  });

  it("keeps Tailwind out of the reference folder and declares the phone breakpoint token", () => {
    expect(globals).toMatch(/@source\s+not\s+["']\.\.\/\.\.\/design["']/);
    // ≤700 px is the phone (DESIGN.md §2): `wide:` starts at 701 px, `max-wide:` is the phone.
    const bp = globals.match(/--breakpoint-wide\s*:\s*([^;]+);/)?.[1].trim();
    expect(bp === "701px" || bp === "43.8125rem", `--breakpoint-wide is ${bp}`).toBe(true);
  });

  it("defines the type scale utilities the ported components use", () => {
    for (const u of ["title-page", "title-section", "title-small", "lead", "body", "label", "eyebrow", "caption"])
      expect(globals).toMatch(new RegExp(`@utility text-${u}\\s*\\{[^}]*var\\(--text-${u}\\)`));
  });
});

describe("fonts and the held light scheme (hidden)", () => {
  it("loads Source Serif 4 and Source Sans 3 into --font-serif and --font-sans; Inter is gone", () => {
    expect(layout).toMatch(/Source_Serif_4\(\s*\{[^}]*variable:\s*["']--font-serif["']/);
    expect(layout).toMatch(/Source_Sans_3\(\s*\{[^}]*variable:\s*["']--font-sans["']/);
    expect(layout).not.toMatch(/\bInter\b/);
  });

  it("drops the theme boot script and data-mode switching on <html>", () => {
    expect(layout).not.toMatch(/theme-boot|THEME_BOOT_SCRIPT/);
    expect(layout).not.toMatch(/data-mode=\{/);
  });

  it("defaults the theme hook to light, so the toaster matches the page", async () => {
    const { DEFAULT_MODE } = await import("../../src/lib/themes");
    expect(DEFAULT_MODE).toBe("light");
  });
});
