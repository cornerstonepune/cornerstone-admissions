// @vitest-environment jsdom
// #63 hidden · toaster held light however dark is asked for; cn() treats all eight type-scale utilities as font sizes;
// the layer line is the very first rule and exactly the platform's; the viewport is light only.
import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "@/hooks/use-theme";
import { ThemedToaster } from "@/components/themed-toaster";
import { cn } from "@/lib/utils";

vi.mock("sonner", () => ({
  Toaster: ({ theme }: { theme?: string }) =>
    createElement("div", { "data-testid": "toaster", "data-toaster-theme": theme ?? "unset" }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom swaps the global URL, so resolve from the repo root (vitest runs there) instead of import.meta.url.
const read = (p: string) => readFileSync(`${process.cwd()}/${p}`, "utf8");

afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.mode;
  document.body.innerHTML = "";
});

async function toasterTheme(): Promise<string | null> {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  await act(async () => root.render(createElement(ThemeProvider, null, createElement(ThemedToaster))));
  const theme = container.querySelector("[data-testid=toaster]")?.getAttribute("data-toaster-theme") ?? null;
  await act(async () => root.unmount());
  return theme;
}

describe("ThemedToaster is held light", () => {
  it("ignores data-mode=dark left on <html>", async () => {
    document.documentElement.dataset.mode = "dark";
    expect(await toasterTheme()).toBe("light");
  });

  it("ignores a dark mode saved in another tab (storage event)", async () => {
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    await act(async () => root.render(createElement(ThemeProvider, null, createElement(ThemedToaster))));
    await act(async () => {
      localStorage.setItem("wacrm.mode", "dark");
      window.dispatchEvent(new StorageEvent("storage", { key: "wacrm.mode", newValue: "dark" }));
    });
    expect(container.querySelector("[data-testid=toaster]")?.getAttribute("data-toaster-theme")).toBe("light");
    await act(async () => root.unmount());
  });

  it("is light with nothing saved", async () => {
    expect(await toasterTheme()).toBe("light");
  });
});

const SCALE = [
  "text-title-page",
  "text-title-section",
  "text-title-small",
  "text-lead",
  "text-body",
  "text-label",
  "text-eyebrow",
  "text-caption",
];

describe("cn() knows every type-scale utility", () => {
  it("covers every @utility text-* in globals.css", () => {
    const declared = [...read("src/app/globals.css").matchAll(/@utility\s+(text-[\w-]+)/g)].map((m) => m[1]);
    expect(declared.sort()).toEqual([...SCALE].sort());
  });

  it.each(SCALE)("keeps %s beside text colours", (size) => {
    expect(cn(size, "text-foreground").split(" ").sort()).toEqual([size, "text-foreground"].sort());
    expect(cn("text-muted-foreground", size).split(" ").sort()).toEqual(["text-muted-foreground", size].sort());
  });

  it.each(SCALE)("%s replaces a Tailwind size and is replaced by one", (size) => {
    expect(cn("text-sm", size)).toBe(size);
    expect(cn(size, "text-xs")).toBe("text-xs");
  });

  it("a later type-scale size wins over an earlier one", () => {
    expect(cn("text-title-page", "text-title-small")).toBe("text-title-small");
    expect(cn("text-eyebrow", "text-label")).toBe("text-label");
  });

  it("still merges ordinary Tailwind classes", () => {
    expect(cn("px-2 py-1", "px-4")).toBe("py-1 px-4");
    expect(cn("text-red-500", "text-primary")).toBe("text-primary");
  });
});

describe("globals.css layer order", () => {
  it("opens with exactly the platform's layer line (after comments)", () => {
    const firstRule = read("src/app/globals.css")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0);
    expect(firstRule).toBe("@layer theme, tokens, base, components, utilities;");
  });

  it("declares the layer order once", () => {
    expect(read("src/app/globals.css").match(/@layer\s+theme\s*,/g)?.length).toBe(1);
  });
});

describe("viewport is light only", () => {
  it("colorScheme is exactly 'light'", () => {
    const layout = read("src/app/layout.tsx");
    expect(layout).toMatch(/colorScheme:\s*["']light["']/);
    expect(layout).not.toMatch(/colorScheme:\s*["'][^"']*dark/);
  });
});
