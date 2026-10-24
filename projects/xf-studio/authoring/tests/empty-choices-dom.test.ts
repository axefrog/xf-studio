import { afterEach, beforeEach, expect, test } from "bun:test";
import { EmptyChoices, EmptyTargetPointer, type EmptyChoicesState } from "../src/studio-ui/components/empty-choices";
import { withEmptyChoices } from "../src/studio-ui/panels/empty-choices";
import { h } from "../src/studio-ui/dom";
import { Frame, StudioRuntime } from "../src/studio-ui/runtime";
import { trustedFixture } from "./studio-presentation-fixture";
import { featureViewContext } from "../src/studio-ui/views/feature-context";
import { presetsPanel, libraryPanel } from "../src/features/eye-makeup/view/collection";
import { STUDIO_CATALOGUE } from "../src/compose/views";
import type { Feedback } from "../src/studio-ui/feedback";
import { installLightDom, lightDocument, lightEvent, type LightElement, uninstallLightDom } from "./light-dom";
import { DockView } from "../src/studio-ui/dock/dock-view";
import { group, locate, split, type DockTree } from "../src/studio-ui/dock/layout";
let previousWindow: unknown;
beforeEach(() => { installLightDom(); previousWindow = (globalThis as Record<string, unknown>).window;
  (globalThis as Record<string, unknown>).window = { innerWidth: 1400, innerHeight: 1000, addEventListener: () => {}, removeEventListener: () => {} }; });
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

test("after the last preset is removed, real collection panels keep recovery and imports beside the owner state", () => {
  const { shell } = trustedFixture(), snapshot = { title: "Show which look?", body: "There are no looks in this profile yet.", capability: { available: true }, choices: [],
    owner: { panel: "presets", label: "Presets", prompt: "No look in this scene. Choose one in" } };
  const port = { ...shell, emptyChoices: { snapshot: () => snapshot } } as unknown as ConstructorParameters<typeof StudioRuntime>[0];
  const rt = new StudioRuntime(port, { toast: () => {}, record: () => {}, announce: () => {} } as unknown as Feedback, STUDIO_CATALOGUE);
  const ctx = featureViewContext(rt, "eye-makeup"), panels = [presetsPanel(ctx), libraryPanel(ctx)].map(panel => withEmptyChoices(rt, panel));
  const selected = shell.library.summary().draft!.selected!;
  expect(shell.authoring.dispatch({ kind: "preset.edit", command: { kind: "remove", id: selected } }).ok).toBe(true);
  const visible = (node: LightElement) => { for (let at: LightElement | null = node; at; at = at.parentNode) if (at.hidden) return false; return true; };
  try {
    for (const panel of panels) { lightDocument.body.append(el(panel.spec.element)); panel.update(new Frame(port, STUDIO_CATALOGUE)); }
    const presets = el(panels[0]!.spec.element), library = el(panels[1]!.spec.element);
    const restore = presets.querySelectorAll("button").find(button => button.textContent.includes("Restore “"))!;
    expect(restore).toBeDefined(); expect(visible(restore)).toBe(true);
    for (const [root, label] of [[presets, "Import recipe as preset…"], [library, "Import collection…"]] as const) {
      const button = root.querySelectorAll("button").find(button => button.textContent.includes(label))!;
      expect(button).toBeDefined(); expect(visible(button)).toBe(true);
      expect(visible(root.querySelector(root === presets ? ".empty-choices" : ".empty-target-pointer")!)).toBe(true);
      if (root === library) expect(visible(root.querySelector(".empty-choices")!)).toBe(false);
    }
    // Conflict notices can arrive after the empty state, while the collection controller keeps painting.
    const summary = shell.library.summary();
    const conflicted = { ...summary, draft: { ...summary.draft!, conflicts: [
      { id: "conflict", message: "This collection changed elsewhere.", keepBoth: true, subject: "this collection" },
    ] } };
    panels[0]!.update(new Frame({ ...port, library: { ...port.library, summary: () => conflicted } }, STUDIO_CATALOGUE));
    const conflict = presets.querySelector(".doc-conflict")!;
    expect(visible(conflict)).toBe(true);
    expect(conflict.querySelectorAll("button").filter(visible)).toHaveLength(3);
    restore.click();
    expect(shell.library.summary().draft!.presets).toHaveLength(1);
  } finally { for (const panel of panels) { panel.dispose?.(); panel.spec.element.remove(); } }
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
  const snapshot = { title: "Show which look?", body: "This scene has no look yet.", capability: { available: true }, choices: [{ id: "l", label: "Smoky", name: "Show Smoky in this scene", action: { destination: { route: "look" } } }] };
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

test("the quiet owner pointer is one paragraph with a keyboard-accessible, read-safe reveal action", () => {
  const revealed: string[] = [], pointer = new EmptyTargetPointer(panel => revealed.push(panel));
  pointer.update({ panel: "presets", label: "Presets", prompt: "No look in this scene. Choose one in" });
  lightDocument.body.append(el(pointer.element));
  expect(pointer.element.textContent).toBe("No look in this scene. Choose one in Presets.");
  expect(el(pointer.element).querySelectorAll("button")).toHaveLength(1);
  const link = el(pointer.element).querySelector("button")!;
  expect(link.getAttribute("data-read-safe")).toBe(""); expect(link.getAttribute("aria-label")).toBe("Open Presets");
  link.focus(); link.click(); expect(revealed).toEqual(["presets"]);
  pointer.update(null); expect(pointer.element.hidden).toBe(true); pointer.element.remove();
});

test("head-pane choices use the centred c-setup state and retain searchable Choose…", () => {
  const component = new EmptyChoices("viewport"); component.update({ ...state(8, []), title: "Show which V?" });
  lightDocument.body.append(el(component.element));
  expect(el(component.element).classList.contains("viewport-state")).toBe(true);
  expect(el(component.element).classList.contains("empty")).toBe(false);
  expect(el(component.element).querySelector(".viewport-state-icon")!.children[0]!.tagName).toBe("svg");
  expect(el(component.element).querySelector(".empty-title")!.textContent).toBe("Show which V?");
  el(component.element).querySelectorAll("button").at(-1)!.click();
  expect(lightDocument.body.querySelector(".empty-choice-picker")!.querySelector("input")).not.toBeNull();
  component.dispose(); component.element.remove();
});

for (const closed of [false, true]) test(`the read-only pointer reveals and focuses Presets (closed: ${closed})`, async () => {
  const presets = h("div"), layers = h("div"), tree: DockTree = { root: split("row", [group(["layers"]),
    { ...group(["presets"]), collapsed: true }]), floating: [], closed: [] };
  const dock = new DockView({ panels: [
    { id: "presets", title: "Presets", description: "", icon: "layers", element: presets },
    { id: "layers", title: "Layers", description: "", icon: "layers", element: layers },
  ], state: { wide: tree, compact: tree }, sizeClass: () => "wide", defaults: () => tree, save() {}, announce() {} });
  dock.render(); if (closed) dock.close("presets");
  const snapshot = { title: "Show which look?", body: "This scene has no look yet.", choices: [],
    capability: { available: false, reason: "This workspace is read-only." },
    owner: { panel: "presets", label: "Presets", prompt: "No look in this scene. Choose one in" } };
  const rt = { port: { emptyChoices: { snapshot: () => snapshot } }, dock } as unknown as StudioRuntime;
  const panel = withEmptyChoices(rt, { spec: { id: "layers", title: "Layers", description: "", icon: "layers", element: layers }, update() {} });
  try {
    panel.update({} as Frame); el(layers).querySelector(".empty-target-pointer")!.querySelector("button")!.click();
    const at = locate(dock.tree, "presets")!;
    expect(at.group.active).toBe("presets"); expect(at.group.collapsed).not.toBe(true);
    await Bun.sleep(5); expect(lightDocument.activeElement?.getAttribute("id")).toBe("dock-tab-presets");
  } finally { panel.dispose?.(); }
});

test("Open a 3D view requests its captured slot only after a successful application choice", async () => {
  const arrangement = { saved: "the requested tab's arrangement" }, shown: unknown[][] = [], calls: string[] = [];
  let ok = true;
  const rt = { port: { tabs: { dock: (tab: string) => { expect(tab).toBe("requested"); return arrangement; } },
    emptyChoices: { snapshot: () => ({ title: "Open a 3D view", body: "This tab has no 3D view.", choices: [{
      id: "default", label: "Use the default V", action: { destination: { route: "view", tab: "requested" } },
    }] }), execute: async () => { calls.push("execute"); return { ok }; } } },
    changed: () => { calls.push("changed"); }, report() {},
    showOpenedView: (...args: unknown[]) => { shown.push(args); } } as unknown as StudioRuntime;
  const panel = withEmptyChoices(rt, { spec: { id: "layers", title: "Layers", description: "", icon: "layers", element: h("div") }, update() {} });
  try {
    panel.update({} as Frame); el(panel.spec.element).querySelector(".empty-actions")!.querySelector("button")!.click();
    expect(calls).toEqual(["execute", "changed"]); expect(shown).toEqual([]);
    await Promise.resolve(); expect(shown).toEqual([["requested", arrangement]]);
    ok = false; el(panel.spec.element).querySelector(".empty-actions")!.querySelector("button")!.click(); await Promise.resolve();
    expect(shown).toHaveLength(1);
  } finally { panel.dispose?.(); }
});
