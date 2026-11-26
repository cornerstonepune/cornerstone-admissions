// Hidden #8: the whole agreed icon table, look-alike states drawn in different shapes, Link pass-through, ux-rules edges.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import * as L from "lucide-react";

vi.mock("next/link", () => ({
  default: (p: { href: string; prefetch?: boolean; className?: string; children?: React.ReactNode }) =>
    createElement("a", { href: p.href, className: p.className, "data-prefetch": String(p.prefetch) }, p.children),
}));

const { ICONS, ICON_NAMES, Icon } = await import("../../src/admissions/components/icons");
const { default: Link } = await import("../../src/admissions/components/link");
const { isEmptyCell, pageOf, visibleColumns, groupRows } = await import("../../src/admissions/lib/ux-rules");

// The table in issue #8.
const AGREED: Record<string, keyof typeof L> = {
  today: "Sun", inbox: "Inbox", pipeline: "Columns3", parents: "UsersRound", notifications: "Bell", report: "ChartColumn",
  dashboard: "LayoutDashboard", "admissions-settings": "SlidersHorizontal", flows: "Workflow", automations: "Zap",
  setup: "Settings", help: "CircleHelp", "sign-out": "LogOut", menu: "Menu", collapse: "PanelLeftClose", expand: "PanelLeftOpen",
  search: "Search", person: "UserRound",
  done: "CircleCheck", "to-confirm": "Clock", "fix-this": "TriangleAlert", "to-do": "Circle", late: "Hourglass", "not-seen": "CircleDashed",
  lead: "UserRound", parent: "House", visit: "CalendarCheck", campus: "School", call: "Phone", note: "StickyNote",
  message: "MessageCircle", "follow-up": "CalendarClock", template: "FileText", source: "Signpost", lost: "UserX",
  send: "SendHorizontal", confirm: "Check", correct: "PenLine", filter: "Funnel", next: "ArrowRight", clear: "Eraser",
  close: "X", add: "Plus", "quick-add": "UserPlus", previous: "ChevronLeft", following: "ChevronRight",
  "chevron-down": "ChevronDown", details: "Eye", upload: "Upload", table: "Table", board: "Columns3", history: "History",
};

describe("the agreed icon table (hidden)", () => {
  it("names exactly the agreed concepts", () => {
    expect([...ICON_NAMES].sort()).toEqual(Object.keys(AGREED).sort());
  });

  it.each(Object.entries(AGREED))("%s is Lucide's %s", (name, lucide) => {
    expect(ICONS[name as keyof typeof ICONS]).toBe(L[lucide]);
  });

  it("draws the four state shapes and late differently, so a chip reads without its colour", () => {
    const shapes = ["done", "to-confirm", "fix-this", "to-do", "late", "not-seen"].map((n) => ICONS[n as keyof typeof ICONS]);
    expect(new Set(shapes).size).toBe(shapes.length);
    expect(ICONS.done).not.toBe(ICONS.confirm);
  });

  it("passes a className through and keeps stroke 1.9 at any size", () => {
    const svg = renderToStaticMarkup(createElement(Icon, { name: "visit", size: 24, className: "x-1" }));
    expect(svg).toContain("x-1");
    expect(svg).toContain('stroke-width="1.9"');
  });
});

describe("Link (hidden)", () => {
  it("passes className and children through and still never pre-loads", () => {
    const html = renderToStaticMarkup(createElement(Link, { href: "/today", className: "row" }, "Today"));
    expect(html).toBe('<a href="/today" class="row" data-prefetch="false">Today</a>');
  });
});

describe("ux-rules edges (hidden)", () => {
  it.each(["0.00", "0,0", "–", "00"])("%j is empty", (v) => expect(isEmptyCell(v)).toBe(true));
  it.each(["-1", "0.5", "00a", true, "No"])("%j is not empty", (v) => expect(isEmptyCell(v)).toBe(false));

  it("clamps the page to 1…pages, and an empty list is one empty page", () => {
    const rows = Array.from({ length: 23 }, (_, i) => i);
    expect(pageOf(rows, 0).page).toBe(1);
    expect(pageOf(rows, 99)).toMatchObject({ page: 3, pages: 3, rows: [20, 21, 22] });
    expect(pageOf(rows, Number.NaN).page).toBe(1);
    expect(pageOf(rows, 1.7).page).toBe(1);
    expect(pageOf([], 4)).toEqual({ rows: [], page: 1, pages: 1 });
    expect(pageOf(rows, 2, 5).rows).toEqual([5, 6, 7, 8, 9]);
  });

  it("keeps every column when there are no rows, and a `keep` column always", () => {
    const cols = [
      { key: "a", label: "A", value: () => null },
      { key: "b", label: "B", value: () => null, keep: true },
    ];
    expect(visibleColumns(cols, []).map((c) => c.key)).toEqual(["a", "b"]);
    expect(visibleColumns(cols, [{}, {}]).map((c) => c.key)).toEqual(["b"]);
  });

  it("returns no groups for no rows", () => {
    expect(groupRows([], () => "x")).toEqual([]);
  });
});
