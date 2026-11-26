// @vitest-environment jsdom
// G3.3 (UI): the Lost form won't submit without a lost reason, and says why.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LostForm } from "./lead-panel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
});

async function renderForm() {
  const onSubmit = vi.fn();
  await act(async () => {
    root.render(<LostForm reasons={[{ id: "r1", label: "Fees too high" }]} onSubmit={onSubmit} onCancel={() => {}} />);
  });
  const submit = () =>
    act(async () => {
      container.querySelector<HTMLButtonElement>("button[type=submit]")!.click();
    });
  return { onSubmit, submit };
}

describe("LostForm", () => {
  it("sends nothing without a reason and shows why", async () => {
    const { onSubmit, submit } = await renderForm();
    await submit();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(container.querySelector("[role=alert]")?.textContent).toBe("Pick a reason to close this lead as Lost.");
  });

  it("sends the chosen reason", async () => {
    const { onSubmit, submit } = await renderForm();
    const select = container.querySelector("select")!;
    await act(async () => {
      // React tracks the value; set it the way a user's choice does.
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, "r1");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await submit();
    expect(onSubmit).toHaveBeenCalledWith("r1");
  });
});
