/**
 * Browser page for tests/dock-strip-stack-geometry.test.ts (bundled there, run in headless Chrome with the real studio.css inlined). It
 * renders a dock whose right-hand column holds two collapsed groups, so the column folds to a stack of vertical strips, then shrinks
 * the workspace step by step and grows it back. At each height it records every strip's stage and laid-out height, and the same for a
 * dock rendered afresh at that height, as plain data in `window.probe`. The test asserts that the two agree (UI-120); this page only
 * measures. Nothing here reads game files.
 */
import { DockView } from "../src/studio-ui/dock/dock-view";
import type { DockTree } from "../src/studio-ui/dock/layout";
import type { IconName } from "../src/studio-ui/icons";

/** public/studio.css, inlined by the test (runProbePage's `define`). */
declare const STUDIO_CSS: string;

export type StripState = { group: string; stage: string; height: number; overflowed: number };
export type StackStep = { height: number; resized: StripState[]; fresh: StripState[] };
export type StackProbe = { ok: boolean; failure?: string; steps: StackStep[] };

const PANELS: [string, string, IconName][] = [["head", "3D view", "head"], ["edge", "Pigment & edge", "edge"], ["warp", "Warp", "warp"],
  ["finish", "Colour & finish", "finish"], ["shape", "Shape", "shape"], ["layers", "Layers", "layers"], ["history", "History", "history"], ["uv", "UV map", "uv"]];
const TREE: DockTree = { floating: [], closed: [], root: { kind: "split", id: "s-root", axis: "row", sizes: [.7, .3], children: [
  { kind: "group", id: "g-head", panels: ["head"], active: "head" },
  { kind: "split", id: "s-col", axis: "column", sizes: [.5, .5], children: [
    { kind: "group", id: "g-a", panels: ["uv", "history", "layers"], active: "uv", collapsed: true },
    { kind: "group", id: "g-b", panels: ["edge", "warp", "finish", "shape"], active: "finish", collapsed: true }] }] } };
export const HEIGHTS = [900, 700, 520, 420, 300, 240, 420, 520, 700, 900];

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function mount(height: number) {
  const host = document.createElement("div");
  host.style.cssText = `position: absolute; left: 0; top: 0; width: 1000px; height: ${height}px;`;
  document.body.append(host);
  const view = new DockView({ panels: PANELS.map(([id, title, icon]) => ({ id, title, icon, description: title, element: document.createElement("div") })),
    state: { wide: TREE, compact: TREE }, sizeClass: () => "wide", defaults: () => TREE, save: () => {}, announce: () => {} });
  host.append(view.element);
  view.render();
  return { host, view };
}
/** Let the headers refit: the ResizeObserver where the page delivers it, and the dock's own refit (a window resize) as the shell does. */
async function settle(view: DockView) {
  for (let i = 0; i < 4; i++) { await wait(60); view.condenseTabs(); }
}
const strips = (view: DockView): StripState[] => [...view.element.querySelectorAll<HTMLElement>(".dock-group.collapsed")].map(group => ({
  group: group.dataset.group ?? "", stage: group.querySelector<HTMLElement>(".tab-strip")?.dataset.stage ?? "",
  height: Math.round(group.getBoundingClientRect().height), overflowed: group.querySelectorAll(".dock-tab[hidden]").length }));

async function run(): Promise<StackStep[]> {
  const style = document.createElement("style");
  style.textContent = STUDIO_CSS;
  document.head.append(style);
  const resizing = mount(HEIGHTS[0]!);
  const steps: StackStep[] = [];
  for (const height of HEIGHTS) {
    resizing.host.style.height = `${height}px`;
    await settle(resizing.view);
    const fresh = mount(height);
    fresh.host.style.visibility = "hidden";
    await settle(fresh.view);
    steps.push({ height, resized: strips(resizing.view), fresh: strips(fresh.view) });
    fresh.host.remove();
  }
  return steps;
}

run().then(steps => { (window as unknown as { probe: StackProbe }).probe = { ok: true, steps }; },
  error => { (window as unknown as { probe: StackProbe }).probe = { ok: false, failure: String((error as Error)?.stack ?? error), steps: [] }; });
