import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { describe, expect, it } from "vitest";
import App from "../src/ui/App";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("UI smoke", () => {
  it("renders modes, local-only banner and switches language", async () => {
    const el = document.createElement("div"); document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => { root.render(createElement(App)); });
    expect(el.textContent).toContain("Local-only processing");
    expect(el.querySelectorAll('input[type="radio"]')).toHaveLength(3);
    const sel = el.querySelector(".langsel select") as HTMLSelectElement;
    await act(async () => { sel.value = "fr"; sel.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(el.textContent).toContain("Traitement exclusivement local");
    const restore = el.querySelectorAll('input[type="radio"]')[2] as HTMLInputElement;
    await act(async () => { restore.click(); });
    expect(el.querySelector('input[type="file"][accept=".lamap"]')).not.toBeNull();
    await act(async () => { root.unmount(); });
  });
});
