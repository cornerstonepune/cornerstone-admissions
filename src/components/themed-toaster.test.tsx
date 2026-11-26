// @vitest-environment jsdom
// #63 · The toaster is held light like the page: a saved wacrm.mode=dark must not turn toasts dark.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "@/hooks/use-theme";
import { ThemedToaster } from "./themed-toaster";

// Stand-in for sonner's Toaster: shows the theme it was handed.
vi.mock("sonner", () => ({
  Toaster: ({ theme }: { theme?: string }) => <div data-testid="toaster" data-toaster-theme={theme ?? "unset"} />,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});
afterEach(() => {
  container.remove();
  localStorage.clear();
});

async function toasterTheme(): Promise<string | null> {
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <ThemeProvider>
        <ThemedToaster />
      </ThemeProvider>,
    );
  });
  const theme = container.querySelector("[data-testid=toaster]")?.getAttribute("data-toaster-theme") ?? null;
  await act(async () => root.unmount());
  return theme;
}

describe("ThemedToaster", () => {
  it("stays light when wacrm.mode=dark is saved in localStorage", async () => {
    localStorage.setItem("wacrm.mode", "dark");
    expect(await toasterTheme()).toBe("light");
  });
});
