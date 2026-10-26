// Enter or Down on a dock tab puts focus in the panel's content (dock-view.ts `focusContent`). That follows keyboard input, so the focus
// would match :focus-visible: it must never land on a help icon (its tip would open unasked), nor on a natively disabled control.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { installLightDom, lightDocument, lightEvent, uninstallLightDom, type LightElement } from "./light-dom";
import type { DockTree } from "../src/studio-ui/dock/layout";

beforeAll(() => installLightDom());
afterAll(() => uninstallLightDom());

test("focusContent skips help icons and natively disabled controls, and a tip stays closed", async () => {
  const { DockView } = await import("../src/studio-ui/dock/dock-view");
  const { helpTip, installHelpTips } = await import("../src/studio-ui/help-tip");
  const panel = document.createElement("div") as unknown as LightElement;
  const tip = helpTip("Game", "What the Game group is.") as unknown as LightElement;
  const disabled = document.createElement("input") as unknown as LightElement; disabled.disabled = true;
  const unavailable = document.createElement("button") as unknown as LightElement; unavailable.setAttribute("aria-disabled", "true");
  const real = document.createElement("button") as unknown as LightElement;
  panel.append(tip, disabled, unavailable, real);
  const tree: DockTree = { floating: [], closed: [], root: { kind: "group", id: "g", panels: ["game"], active: "game" } };
  const view = new DockView({ panels: [{ id: "game", title: "Game", icon: "layers" as const, description: "Game", element: panel as unknown as HTMLElement }],
    state: { wide: tree, compact: tree }, sizeClass: () => "wide", defaults: () => tree, save: () => {}, announce: () => {} });
  view.render();
  installHelpTips(Object.create(lightDocument) as never);
  const bubble = lightDocument.body.querySelector(".help-bubble")!;

  // The keyboard is in use: the control reached by script matches :focus-visible, as in a browser.
  for (const control of [tip, disabled, unavailable, real]) control.focusVisible = true;
  view.focusContent("game");
  // The first focusable control is the unavailable (aria-disabled) action, which stays focusable; the help icon and the disabled input are skipped.
  expect(lightDocument.activeElement).toBe(unavailable);
  expect(bubble.hidden).toBe(true);

  // Without it, the real button is first.
  unavailable.remove();
  lightDocument.activeElement = null;
  view.focusContent("game");
  expect(lightDocument.activeElement as LightElement | null).toBe(real);
  expect(bubble.hidden).toBe(true);
  void lightEvent;
});
