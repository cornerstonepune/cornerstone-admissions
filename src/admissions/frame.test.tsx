// @vitest-environment jsdom
// #18 · The Cornerstone frame: the current page is lit, the fold survives reload, a phone gets a drawer from the Menu button,
// the mark links to Today, icons are a closed set, and Settings › Appearance is gone.
import { readFileSync } from "node:fs";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let pathname = "/inbox";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("next/link", () => ({
  default: ({ href, prefetch, ...rest }: { href: string; prefetch?: boolean } & Record<string, unknown>) => (
    <a href={href} data-prefetch={String(prefetch)} {...rest} />
  ),
}));
vi.mock("@/hooks/use-unread-notifications", () => ({ useUnreadNotifications: () => 12 }));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ profile: { full_name: "Meera S." }, accountRole: "admin", signOut: vi.fn() }),
}));

import { FOLD_KEY, MENU, Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { ICONS, type IconName } from "./components/icons";
import { SETTINGS_SECTIONS, resolveSection } from "@/components/settings/settings-sections";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  pathname = "/inbox";
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  localStorage.clear();
});

const render = (node: React.ReactNode) => act(async () => root.render(node));
const link = (name: string) => [...container.querySelectorAll("a")].find((a) => a.textContent?.startsWith(name))!;

function Frame() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Header onOpenSidebar={() => setOpen(true)} />
      <Sidebar open={open} onClose={() => setOpen(false)} />
    </>
  );
}

describe("the sidebar", () => {
  it("marks only the current page with aria-current and the action-soft fill", async () => {
    pathname = "/inbox/abc";
    await render(<Sidebar />);
    const current = container.querySelectorAll('[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0].textContent).toBe("Inbox");
    expect(current[0].className).toContain("bg-[var(--action-soft)]");
    expect(link("Pipeline").className).not.toContain("action-soft");
  });

  it("caps the notifications count at 9+", async () => {
    await render(<Sidebar />);
    expect(link("Notifications").textContent).toContain("9+");
  });

  it("folds to icons, and the fold survives a reload", async () => {
    await render(<Sidebar />);
    const fold = container.querySelector<HTMLButtonElement>('button[aria-label="Fold the sidebar"]')!;
    await act(async () => fold.click());
    expect(localStorage.getItem(FOLD_KEY)).toBe("1");

    await act(async () => root.unmount());
    root = createRoot(container);
    await render(<Sidebar />);
    expect(container.querySelector("[data-folded]")).not.toBeNull();
    expect(container.querySelector('button[aria-label="Unfold the sidebar"]')?.getAttribute("aria-expanded")).toBe("false");
    // folded, the word stays for a screen reader
    expect(link("Inbox").querySelector(".wide\\:sr-only")?.textContent).toBe("Inbox");
  });

  it("lists the S-frame doors and none of the hidden screens", () => {
    const hrefs = MENU.flatMap((g) => g.doors.map((d) => d.href));
    expect(MENU.map((g) => g.group)).toEqual(["Daily work", "Oversight", "Set up"]);
    for (const hidden of ["/broadcasts", "/agents", "/signup"]) expect(hrefs).not.toContain(hidden);
    expect(hrefs.some((h) => h.includes("appearance"))).toBe(false);
  });
});

describe("on a phone (700 px or less)", () => {
  it("opens the sidebar as a modal drawer from the Menu button; Escape closes it", async () => {
    await render(<Frame />);
    const menu = [...container.querySelectorAll("button")].find((b) => b.textContent === "Menu")!;
    // the Menu button exists only below the wide breakpoint; the drawer is hidden there until opened
    expect(menu.className).toContain("wide:hidden");
    expect(container.querySelector('[role="dialog"]')).toBeNull();

    menu.focus(); // a real click focuses the button; jsdom's click() does not
    await act(async () => menu.click());
    const drawer = container.querySelector('[role="dialog"]')!;
    expect(drawer.getAttribute("aria-modal")).toBe("true");
    expect(drawer.className).not.toContain("max-wide:hidden");
    expect(drawer.contains(document.activeElement)).toBe(true);

    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(menu);
  });
});

describe("the bar", () => {
  it("links the brand mark to Today", async () => {
    await render(<Header />);
    const mark = container.querySelector("[data-brand-mark]")!.closest("a")!;
    expect(mark.getAttribute("href")).toBe("/today");
    expect(mark.querySelector("img")?.getAttribute("alt")).toBe("Cornerstone Admissions");
  });
});

describe("the icon map", () => {
  it("only accepts known concepts", () => {
    // @ts-expect-error an unknown concept is a type error, not a blank icon
    const unknown: IconName = "lesson";
    expect(Object.keys(ICONS)).not.toContain(unknown);
  });
});

describe("Settings › Appearance (hidden in v1, ADR 0014 §3)", () => {
  it("is not listed and its address falls back to the overview", () => {
    expect(SETTINGS_SECTIONS).not.toContain("appearance");
    expect(resolveSection("appearance")).toBe("overview");
  });
});

describe("the frame uses tokens only", () => {
  const files = [
    "src/components/layout/sidebar.tsx",
    "src/components/layout/header.tsx",
    "src/admissions/components/brand-mark.tsx",
    "src/admissions/components/page-head.tsx",
    "src/admissions/components/icons.tsx",
    "src/admissions/styles/blocks.css",
  ];
  it.each(files.map((f) => [f]))("%s has no raw colour or arbitrary px value", (f) => {
    // vitest runs from the repo root; jsdom's URL is not one fs accepts
    const src = readFileSync(f, "utf8");
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|oklch\(/);
    expect(src).not.toMatch(/-\[[^\]]*\d+px[^\]]*\]/);
  });
});
