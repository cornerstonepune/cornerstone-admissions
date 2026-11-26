// #8 · One icon map: every concept draws a Lucide icon at the design's sizes, stroke 1.9, hidden from screen readers.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Inbox, Sun, UserRound } from "lucide-react";

vi.mock("next/link", () => ({
  default: (p: { href: string; prefetch?: boolean; children?: React.ReactNode }) =>
    createElement("a", { href: p.href, "data-prefetch": String(p.prefetch) }, p.children),
}));

import { ICONS, ICON_NAMES, ICON_SIZE, Icon, type IconName } from "./icons";
import Link from "./link";

const draw = (name: IconName, size?: number) => renderToStaticMarkup(createElement(Icon, { name, size }));

describe("the icon map", () => {
  it.each(ICON_NAMES.map((n) => [n]))("%s draws an svg", (name) => {
    expect(ICONS[name], `${name} has no icon`).toBeDefined();
    expect(draw(name)).toMatch(/^<svg/);
  });

  it("maps the sidebar's first doors and a lead to their agreed icons", () => {
    expect(ICONS.today).toBe(Sun);
    expect(ICONS.inbox).toBe(Inbox);
    expect(ICONS.lead).toBe(UserRound);
  });

  it.each([ICON_SIZE.table, ICON_SIZE.row, ICON_SIZE.heading])("draws at %i px with stroke 1.9, hidden from screen readers", (size) => {
    const svg = draw("lead", size);
    expect(svg).toContain(`width="${size}"`);
    expect(svg).toContain(`height="${size}"`);
    expect(svg).toContain('stroke-width="1.9"');
    expect(svg).toContain('aria-hidden="true"');
    expect(svg).toContain('data-icon="lead"');
  });

  it("draws at the row size (20) when no size is given", () => {
    expect(draw("call")).toContain('width="20"');
  });

  it("only accepts known concepts", () => {
    // @ts-expect-error an unknown concept is a type error, not a blank icon
    const unknown: IconName = "lesson";
    expect(ICON_NAMES).not.toContain(unknown);
  });
});

describe("Link", () => {
  it("renders the link without loading its page in advance", () => {
    const html = renderToStaticMarkup(createElement(Link, { href: "/leads/1" }, "Aarav"));
    expect(html).toBe('<a href="/leads/1" data-prefetch="false">Aarav</a>');
  });
});
