// DockView's optional lifetime signal: aborting it withdraws the dock it rendered.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { installLightDom, uninstallLightDom } from "./light-dom";
import type { DockTree } from "../src/studio-ui/dock/layout";

beforeAll(() => installLightDom());
afterAll(() => uninstallLightDom());

test("aborting the dock's signal removes the dock and stops reacting", async () => {
  const { DockView } = await import("../src/studio-ui/dock/dock-view");
  const tree: DockTree = { floating: [], closed: [], root: { kind: "group", id: "only", panels: ["head", "finish"], active: "head" } };
  const life = new AbortController(), saved: DockTree[] = [];
  const view = new DockView({ signal: life.signal,
    panels: ["head", "finish"].map(id => ({ id, title: id, icon: "layers" as const, description: id, element: document.createElement("div") })),
    state: { wide: tree, compact: tree }, sizeClass: () => "wide", defaults: () => tree, save: state => saved.push(state.wide), announce: () => {} });
  const host = document.createElement("div"); host.append(view.element); view.render();
  expect(view.element.parentNode).toBe(host);
  life.abort();
  expect(view.element.parentNode).toBeNull();
  expect(() => view.cancelDrag()).not.toThrow();
});
