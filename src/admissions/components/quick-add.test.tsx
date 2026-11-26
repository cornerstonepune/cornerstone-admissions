// @vitest-environment jsdom
// S-quick-add (M4, #67): a wrong phone never leaves the form; a save sends the chosen source; a known family says so;
// a failed save keeps what was typed.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { QuickAdd } from "./quick-add";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn();
beforeEach(async () => {
  vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const sources = [
    { key: "walk_in", label: "Walk-in" },
    { key: "phone_call", label: "Phone call" },
  ];
  await act(async () => root.render(<QuickAdd sources={sources} added={[]} />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const field = (id: string) => container.querySelector<HTMLInputElement>(`#${id}`)!;
const type = (id: string, v: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field(id), v);
    field(id).dispatchEvent(new Event("input", { bubbles: true }));
  });
const click = (el: Element) => act(async () => (el as HTMLElement).click());
const save = () => click(container.querySelector("button[type=submit]")!);

describe("QuickAdd", () => {
  it("refuses a wrong phone without sending anything", async () => {
    await type("qa-phone", "98765 12");
    await save();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.querySelector("[role=alert]")?.textContent).toBe("Enter a 10-digit mobile number.");
  });

  it("sends the chosen source and says when the family is already with us", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ created: false, lead_id: "l" }), { status: 200 }));
    await click([...container.querySelectorAll("button")].find((b) => b.textContent === "Phone call")!);
    await type("qa-phone", "+91 98765 43210");
    await type("qa-parent", "Sunita Patil");
    await save();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ phone: "+91 98765 43210", parent: "Sunita Patil", child: "", source: "phone_call" });
    expect(container.querySelector("[role=status]")?.textContent).toContain("This family is already with us");
    expect(field("qa-phone").value).toBe(""); // cleared for the next family
    expect(refresh).toHaveBeenCalled();
  });

  it("keeps what was typed when the save fails", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "Couldn't save. Nothing was lost." }), { status: 500 }));
    await type("qa-phone", "9876543210");
    await type("qa-parent", "Deepa Iyer");
    await save();
    expect(container.querySelector("[role=status]")?.textContent).toContain("Couldn't save. Nothing was lost.");
    expect(field("qa-parent").value).toBe("Deepa Iyer");
  });
});
