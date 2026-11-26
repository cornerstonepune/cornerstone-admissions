// @vitest-environment jsdom
// S-today (#69, UI): the screen renders what /api/admissions/today answers — counts with their yardsticks, calls worst
// first with each row's tone, stuck with its limit — and says so when it couldn't load.
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Today } from "@/admissions/lib/today";

vi.mock("./lead-panel", () => ({ LeadPanel: ({ leadId }: { leadId: string | null }) => <aside data-open-lead={leadId ?? ""} /> }));
import { TodayScreen } from "./today";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TODAY: Today = {
  untouchedHours: 24,
  calls: [
    { leadId: "l1", key: "u-l1", why: "untouched", hours: 31, family: "Kavya (Nursery)", parent: "Priya", stage: "Enquiry", reason: "Parent wrote, no reply yet", lastContact: "2026-11-24T03:42:00Z" },
    { leadId: "l2", key: "t2", why: "due", dueAt: "2026-11-25T05:30:00Z", family: "Ira (Grade 2)", parent: "Neha", stage: "Visited", reason: "Rule: Visited, day 7", lastContact: null },
  ],
  counts: { untouched: 1, due: 1, fromRules: 1, visits: 0, stuck: 1 },
  visits: [],
  stuck: [{ leadId: "l3", family: "Kabir (Grade 4)", stage: "Applied", days: 19, limit: 10 }],
  done: [],
};

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(res: Partial<Response>) {
  vi.stubGlobal("fetch", vi.fn(async () => res));
  await act(async () => root.render(<TodayScreen />));
}

describe("TodayScreen", () => {
  it("shows the counts, the calls worst first with their tone, and stuck against its limit", async () => {
    await render({ ok: true, json: async () => TODAY });
    const text = container.textContent ?? "";
    expect(text).toContain("no action in 24 h (Settings › Alerts)");
    expect(text).toContain("1 from rules · 0 by hand");
    expect(text).toContain("1 family has waited over 24 h with no action. Start with Kavya (Nursery)");
    const rows = [...container.querySelectorAll("tbody tr[data-state]")].map((r) => [r.getAttribute("data-state"), r.textContent]);
    expect(rows[0][0]).toBe("late");
    expect(rows[0][1]).toContain("Untouched 31 h");
    expect(rows[1][0]).toBe("wait");
    expect(rows[1][1]).toContain("Rule: Visited, day 7");
    expect(text).toContain("19 d limit 10");
    expect(text).toContain("No visits today.");
  });

  it("opens the lead panel for the family chosen", async () => {
    await render({ ok: true, json: async () => TODAY });
    const button = [...container.querySelectorAll("button")].find((b) => b.textContent === "Ira (Grade 2)")!;
    await act(async () => button.click());
    expect(container.querySelector("aside")?.getAttribute("data-open-lead")).toBe("l2");
  });

  it("uses tokens only: no raw colour or arbitrary px value", () => {
    const src = readFileSync("src/admissions/components/today.tsx", "utf8");
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|oklch\(/);
    expect(src).not.toMatch(/-\[[^\]]*\d+px[^\]]*\]/);
  });

  it("says it couldn't load, with a way to try again", async () => {
    await render({ ok: false });
    expect(container.textContent).toContain("Couldn't load today's list");
    expect(container.textContent).toContain("Try again");
  });
});
