import { afterEach, beforeEach, expect, test } from "bun:test";
import { EmptyChoices, type EmptyChoicesState } from "../src/studio-ui/components/empty-choices";
import { withEmptyChoices } from "../src/studio-ui/panels/empty-choices";
import { h } from "../src/studio-ui/dom";
import type { Frame, StudioRuntime } from "../src/studio-ui/runtime";
import { installLightDom, lightDocument, lightEvent, type LightElement, uninstallLightDom } from "./light-dom";
let previousWindow: unknown;
beforeEach(() => { installLightDom(); previousWindow = (globalThis as Record<string, unknown>).window;
  (globalThis as Record<string, unknown>).window = { innerWidth: 1400, innerHeight: 1000 }; });
afterEach(() => { for (const picker of lightDocument.body.querySelectorAll(".empty-choice-picker")) picker.dispatchEvent(lightEvent("keydown", { key: "Escape" }));
  uninstallLightDom(); if (previousWindow === undefined) delete (globalThis as Record<string, unknown>).window; else (globalThis as Record<string, unknown>).window = previousWindow; });
const el = (value: HTMLElement) => value as unknown as LightElement;
function state(count: number, chosen: string[], prefix = "Look"): EmptyChoicesState {
  return { title: "Show which look?", body: count ? "This scene has no look yet." : "There are no looks in this profile yet.",
    choices: Array.from({ length: count || 1 }, (_, i) => ({ id: String(i), label: count ? `${prefix} ${i + 1}` : "Create a look",
      name: count ? `Show ${prefix} ${i + 1} in this scene` : "Create a look and show it in this scene", choose: () => { chosen.push(`${prefix} ${i + 1}`); } })) };
}
for (const count of [0, 1, 4, 8]) test(`U6's ${count}-candidate specimen composes named native buttons and keeps them while painting`, () => {
  const component = new EmptyChoices(), chosen: string[] = [];
  component.update(state(count, chosen)); lightDocument.body.append(el(component.element));
  const buttons = el(component.element).querySelectorAll("button");
  expect(buttons).toHaveLength(Math.min(count || 1, 6) + (count > 6 ? 1 : 0));
  expect(buttons[0]!.getAttribute("aria-label")).toBe(count ? "Show Look 1 in this scene" : "Create a look and show it in this scene");
  expect(buttons[0]!.tagName).toBe("button"); expect(buttons[0]!.getAttribute("type")).toBe("button");
  component.update(state(count, chosen)); expect(el(component.element).querySelectorAll("button")[0]).toBe(buttons[0]);
  buttons[0]!.focus(); buttons[0]!.click(); expect(chosen).toEqual(["Look 1"]);
  component.dispose(); component.element.remove();
});
test("Choose… focuses searchable results, keeps their captured callbacks, and Escape returns focus", async () => {
  const component = new EmptyChoices(), chosen: string[] = [];
  component.update(state(8, chosen)); lightDocument.body.append(el(component.element));
  const more = el(component.element).querySelectorAll("button").at(-1)!; more.click();
  const picker = lightDocument.body.querySelector(".empty-choice-picker")!, input = picker.querySelector("input")!;
  expect(lightDocument.activeElement).toBe(input); expect(picker.getAttribute("role")).toBe("dialog");
  component.update(state(8, chosen, "Replacement"));
  input.value = "Look 8"; input.dispatchEvent(lightEvent("input")); await Bun.sleep(5);
  const list = picker.querySelector(".empty-choices-list")!;
  expect(list.querySelectorAll("button")).toHaveLength(1);
  input.dispatchEvent(lightEvent("keydown", { key: "ArrowDown" }));
  expect(lightDocument.activeElement).toBe(list.querySelector("button"));
  list.querySelector("button")!.click(); expect(chosen).toEqual(["Look 8"]);
  expect(lightDocument.body.querySelector(".empty-choice-picker")).toBeNull();
  more.click(); const reopened = lightDocument.body.querySelector(".empty-choice-picker")!;
  reopened.dispatchEvent(lightEvent("keydown", { key: "Escape" }));
  expect(lightDocument.activeElement).toBe(more); expect(lightDocument.body.querySelector(".empty-choice-picker")).toBeNull();
  component.dispose(); component.element.remove();
});
test("read-only choices keep their reason visible, refuse clicks and never open the picker", () => {
  const component = new EmptyChoices(), chosen: string[] = [];
  component.update({ ...state(8, chosen), capability: { available: false, reason: "This workspace is read-only." } });
  lightDocument.body.append(el(component.element));
  expect(component.element.textContent).toContain("This workspace is read-only.");
  for (const button of el(component.element).querySelectorAll("button")) { expect(button.getAttribute("aria-disabled")).toBe("true"); button.click(); }
  expect(chosen).toEqual([]); expect(lightDocument.body.querySelector(".empty-choice-picker")).toBeNull();
  component.dispose(); component.element.remove();
});
test("a bound panel's real controller fills immediately and can replace its content without losing U6", () => {
  let missing = true, updates = 0;
  const snapshot = { title: "Show which look?", body: "This scene has no look yet.", capability: { available: true }, choices: [{ id: "l", label: "Smoky", name: "Show Smoky in this scene", action: {} }] };
  const rt = { port: { emptyChoices: { snapshot: () => missing ? snapshot : null, execute: async () => { missing = false; return { ok: true }; } } },
    changed: () => {}, report: () => {} } as unknown as StudioRuntime;
  const content = h("div", {}, h("p", {}, "Feature content")), panel = withEmptyChoices(rt, { spec: { id: "layers", title: "Layers", description: "Makeup layers", icon: "layers", element: content },
    update() { updates++; content.replaceChildren(h("p", {}, "Showing Smoky")); } });
  panel.update({} as Frame); expect((content.children[0] as HTMLElement).hidden).toBe(true); expect(updates).toBe(0);
  el(panel.spec.element).querySelector("button")!.click(); panel.update({} as Frame);
  expect((content.children[0] as HTMLElement).hidden).toBe(false); expect(content.querySelector("p")!.textContent).toBe("Showing Smoky"); expect(updates).toBe(1);
  missing = true; panel.update({} as Frame);
  expect((content.children[0] as HTMLElement).hidden).toBe(true); expect(el(panel.spec.element).querySelector(".empty-choices")!.hidden).toBe(false); panel.dispose?.();
});
