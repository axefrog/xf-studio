import { afterEach, beforeEach, expect, test } from "bun:test";
import { installLightDom, lightDocument, uninstallLightDom } from "./light-dom";
import { closeMenus, openMenu, place } from "../src/studio-ui/menu";

let previousPage: unknown;
beforeEach(() => {
  installLightDom(); previousPage = globalThis.window;
  Object.assign(globalThis, { window: { innerWidth: 900, innerHeight: 900, addEventListener() {}, removeEventListener() {} } });
});
afterEach(() => { closeMenus(false); uninstallLightDom(); Object.assign(globalThis, { window: previousPage }); });
const box = (left: number, top: number, width: number, height: number) => {
  const rect = { x: left, y: top, left, top, right: left + width, bottom: top + height, width, height };
  return { ...rect, toJSON: () => rect };
};

test("Panels keeps its top under the button for short and overflowing states, at either page width", () => {
  const button = document.createElement("button");
  button.getBoundingClientRect = () => box(820, 8, 32, 28);
  lightDocument.body.append(button as never);
  const opened = openMenu([{ kind: "action", label: "3D view", run() {} }], button, { label: "Panels", placement: "below" })!;
  const menu = opened.element;
  expect([menu.style.top, menu.style.maxHeight]).toEqual(["40px", "854px"]);
  for (const width of [900, 1600]) for (const height of [700, 888, 1100, 720]) {
    Object.assign(globalThis.window, { innerWidth: width });
    menu.getBoundingClientRect = () => box(0, 0, 300, Math.min(height, Number.parseFloat(menu.style.maxHeight) || height));
    place(menu, button, false, "below");
    expect(menu.style.top).toBe("40px");
    expect(menu.style.maxHeight).toBe("854px");
    expect(40 + menu.getBoundingClientRect().height).toBeLessThanOrEqual(894);
    expect(Number.parseFloat(menu.style.left) + 300).toBeLessThanOrEqual(width - 6);
  }
});

test("context menus, submenus and ordinary popovers retain their edge-fitting rules", () => {
  const menu = document.createElement("div"), button = document.createElement("button");
  menu.getBoundingClientRect = () => box(0, 0, 250, 200);
  button.getBoundingClientRect = () => box(850, 840, 30, 30);
  place(menu, { x: 890, y: 890 }); expect([menu.style.left, menu.style.top]).toEqual(["640px", "690px"]);
  place(menu, button); expect([menu.style.left, menu.style.top]).toEqual(["644px", "636px"]);
  place(menu, button, true); expect([menu.style.left, menu.style.top]).toEqual(["602px", "694px"]);
});
