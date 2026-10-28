/** Captured on 990ccb54 before slice-8 production edits. Never regenerate from slice-8 code. */
import { expect, test } from "bun:test";
import { helpReference, HELP_LINKS } from "../src/studio-ui/guidance/help-topics";
import { guidanceContents } from "../src/studio-ui/guidance/contributions";
import { anchorCatalogue } from "../src/studio-ui/guidance/anchors";
import { GuidanceService, type GuidanceEnvironment } from "../src/studio-ui/guidance/engine";
import { guidanceFacts, mountGuidance } from "../src/studio-ui/guidance/controller";
import { helpMarkup } from "../src/studio-ui/guidance/render";
import { STUDIO_CATALOGUE, PANEL_IDS, PANEL_META } from "../src/compose/views";
import { StudioRuntime, type Frame, type Port } from "../src/studio-ui/runtime";
import type { GuidanceFacts } from "../src/studio-ui/guidance/types";
import type { Feedback } from "../src/studio-ui/feedback";
import { trustedFixture } from "./studio-presentation-fixture";
import { UIPreferenceActions } from "../src/app/ui-preferences";
import { installLightDom, uninstallLightDom, lightEvent, LightElement } from "./light-dom";

// Preserve every character/newline while avoiding Bun's trailing spaces before multiline string values.
const snapshotValue = (value: unknown): unknown => {
  if (typeof value === "string" && value.includes("\n")) return value.split("\n");
  if (Array.isArray(value)) return value.map(snapshotValue);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, snapshotValue(item)]));
  return value;
};

test("990ccb54 guidance text, steps, anchors, ordering, help markup and navigation outcomes", () => {
  const { shell } = trustedFixture(), rt = new StudioRuntime(shell as unknown as Port, {} as Feedback, STUDIO_CATALOGUE);
  const contributed = guidanceContents(rt), tours = contributed.flatMap(content => content.tours), topics = contributed.flatMap(content => content.topics);
  const anchors = anchorCatalogue(PANEL_IDS, STUDIO_CATALOGUE.guidance.flatMap(source => source.contribution.anchors));
  const walks: unknown[] = [];
  for (const writable of [false, true]) for (const setup of ["loading", "needs", "ready"] as const)
    for (const anchor of ["visible", "hidden", "missing"] as const) for (const tour of tours)
      for (const packageState of (writable && setup === "ready" ? ["none", "check", "build"] : ["none"]) as GuidanceFacts["package"][]) {
      const facts: GuidanceFacts = { layers: 1, activeLayer: "a", finish: "matte", color: "#905774", edit: "1:0:s1", presets: 1,
        lighting: "studio", visiblePanels: [...PANEL_IDS], writable, setup, package: packageState, lastPackage: packageState === "none" ? "" : `${packageState}@1`, installed: 0 };
      const recorded: unknown[] = [];
      const env: GuidanceEnvironment = { facts: () => facts, anchor: () => anchor, panelVisible: () => anchor !== "missing",
        anchorInfo: id => anchors.find(info => info.id === id),
        panelTitle: id => (PANEL_META as Record<string, { title: string }>)[id]?.title ?? id, capability: () => ({ available: true }), record: (...args) => recorded.push(args) };
      const service = new GuidanceService(tours, env), states: unknown[] = [], installNavigation: unknown[] = [];
      service.dispatch({ kind: "guidance.startTour", tourId: tour.id });
      for (let guard = 0; guard < 30 && service.snapshot().active; guard++) {
        const active = service.snapshot().active!;
        states.push({ ...active, tour: active.tour.id });
        if (tour.steps[active.step].id === "install") {
          expect(writable && setup === "ready" && packageState === "build").toBe(true);
          service.dispatch({ kind: "guidance.next" });
          const next = service.snapshot().active!;
          installNavigation.push({ ...next, tour: next.tour.id });
          service.dispatch({ kind: "guidance.back" });
          const back = service.snapshot().active!;
          expect(back.step).toBe(active.step);
          installNavigation.push({ ...back, tour: back.tour.id });
          expect(active.target).toMatchObject(anchor === "missing" ? { kind: "offer", anchor: "package.install" } : { anchor: "package.install" });
        }
        service.dispatch({ kind: "guidance.next" });
      }
      expect(service.snapshot().active).toBeNull();
      service.dispatch({ kind: "guidance.startTour", tourId: tour.id });
      service.dispatch({ kind: "guidance.next" }); service.dispatch({ kind: "guidance.back" });
      const back = service.snapshot().active;
      service.dispatch({ kind: "guidance.skip" });
      walks.push({ writable, setup, package: packageState, anchor, tour: tour.id, states, installNavigation, back: back && { ...back, tour: back.tour.id }, recorded, last: service.snapshot().last });
    }
  const builtWalk = walks.find(walk => {
    const item = walk as { writable: boolean; setup: string; package: string; anchor: string; tour: string };
    return item.writable && item.setup === "ready" && item.package === "build" && item.anchor === "visible" && item.tour === "first-eye-mod";
  }) as { states: { content: { title: string } }[] };
  expect(builtWalk.states.some(state => state.content.title === "Add it to your game")).toBe(true);
  expect(snapshotValue({ tours, topics, markup: topics.map(topic => helpMarkup(topic.body)), anchors,
    reference: helpReference("", contributed.flatMap(content => content.reference ?? [])), links: HELP_LINKS, walks })).toMatchSnapshot("990ccb54 guidance and help output");
});

test("990ccb54 onboarding timing, text, dismissal and replay offer remain identical", () => {
  installLightDom();
  const globals = globalThis as unknown as Record<string, unknown>, oldWindow = globals.window, oldRaf = globals.requestAnimationFrame;
  // Each isolated page needs a distinct document identity for the overlay's document-scoped modality listeners.
  globals.document = new Proxy(document, {});
  const oldNow = Object.getOwnPropertyDescriptor(performance, "now");
  let now = 0;
  Object.defineProperty(performance, "now", { configurable: true, value: () => now });
  globals.window = { innerWidth: 1200, innerHeight: 800, addEventListener() {}, removeEventListener() {} };
  globals.requestAnimationFrame = () => 0;
  try {
    const { shell } = trustedFixture(), announced: string[] = [];
    const rt = new StudioRuntime(shell as unknown as Port, { announce: (text: string) => announced.push(text), toast() {}, record() {} } as unknown as Feedback, STUDIO_CATALOGUE);
    rt.dock = { isVisible: () => true } as unknown as StudioRuntime["dock"];
    const controller = mountGuidance(rt, { openHelp() {} });
    document.body.append(...controller.elements);
    const frame = { status: { verification: false }, preferences: {}, previewSetup: { card: { open: false, canDismiss: false } } } as unknown as Frame;
    const states: unknown[] = [];
    const take = (label: string) => states.push({ label, hidden: controller.offer.element.hidden, text: controller.offer.element.textContent,
      announced: [...announced], status: controller.status("onboarding"), facts: guidanceFacts(rt) });
    controller.update(frame); take("mounted");
    now = 1499; controller.update(frame); take("1499ms");
    now = 1500; controller.update({ ...frame, status: { lease: { writable: false } } } as unknown as Frame); take("read-only");
    controller.update({ ...frame, previewSetup: { card: { open: true, canDismiss: true } } } as unknown as Frame); take("setup card");
    controller.update(frame); take("1500ms");
    const later = [...controller.offer.element.querySelectorAll("button")].find(button => button.textContent === "Not now")!;
    expect(later).toBeDefined(); later.click(); take("dismissed");
    now = 5000; controller.update(frame); take("not repeated");
    controller.offerOnboarding(frame); take("explicit offer");
    expect(snapshotValue(states)).toMatchSnapshot("990ccb54 offer timing and dismissal");
  } finally {
    if (oldNow) Object.defineProperty(performance, "now", oldNow); else delete (performance as unknown as Record<string, unknown>).now;
    globals.window = oldWindow; globals.requestAnimationFrame = oldRaf; uninstallLightDom();
  }
});

test("990ccb54 persisted dismissal, dialog suppression and controller keyboard navigation", () => {
  installLightDom();
  const globals = globalThis as unknown as Record<string, unknown>, oldWindow = globals.window, oldRaf = globals.requestAnimationFrame;
  globals.document = new Proxy(document, {});
  const oldNow = Object.getOwnPropertyDescriptor(performance, "now");
  let now = 0;
  Object.defineProperty(performance, "now", { configurable: true, value: () => now });
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  globals.window = { innerWidth: 1200, innerHeight: 800,
    addEventListener(type: string, listener: (event: unknown) => void) {
      if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type)!.add(listener);
    },
    removeEventListener(type: string, listener: (event: unknown) => void) { listeners.get(type)?.delete(listener); } };
  globals.requestAnimationFrame = () => 0;
  try {
    const states: unknown[] = [];
    const page = (initial?: unknown) => {
      const { shell } = trustedFixture(), preferences = new UIPreferenceActions(initial), announced: string[] = [];
      const port = { ...shell, preferences };
      const rt = new StudioRuntime(port as unknown as Port, { announce: (text: string) => announced.push(text), toast() {}, record() {} } as unknown as Feedback, STUDIO_CATALOGUE);
      rt.dock = { isVisible: () => true } as unknown as StudioRuntime["dock"];
      const controller = mountGuidance(rt, { openHelp() {} });
      document.body.append(...controller.elements);
      const frame = () => ({ status: { verification: false }, preferences: preferences.snapshot(), previewSetup: { card: { open: false, canDismiss: false } } } as unknown as Frame);
      const take = (label: string) => states.push({ label, offer: { hidden: controller.offer.element.hidden, text: controller.offer.element.textContent },
        tour: controller.service.snapshot().active && { ...controller.service.snapshot().active!, tour: controller.service.snapshot().active!.tour.id },
        last: controller.service.snapshot().last, preferences: preferences.snapshot(), announced: [...announced] });
      return { controller, preferences, frame, take };
    };
    const first = page();
    now = 1500;
    const dialog = document.createElement("dialog"); dialog.setAttribute("open", ""); document.body.append(dialog);
    first.controller.update(first.frame()); first.take("offer suppressed by dialog");
    expect(first.controller.offer.visible).toBe(false);
    dialog.remove(); first.controller.update(first.frame()); first.take("offer after dialog closes");
    expect(first.controller.offer.visible).toBe(true);
    [...first.controller.offer.element.querySelectorAll("button")].find(button => button.textContent === "Not now")!.click();
    first.take("dismissed before reload");
    const stored = JSON.parse(JSON.stringify(first.preferences.snapshot()));
    for (const element of first.controller.elements) element.remove(); listeners.clear();
    const second = page(stored);
    now = 3000; second.controller.update(second.frame()); second.take("dismissal restored after reload");
    expect(second.controller.offer.visible).toBe(false); expect(second.controller.status("onboarding")).toBe("declined");
    expect(second.controller.start("onboarding")).toBe(true); second.take("keyboard start");
    const key = (value: string, outside = false) => {
      // Light DOM aliases all element constructors; a text node represents a non-button card target.
      const event = lightEvent("keydown", { key: value, target: (outside ? document.body : document.createTextNode("card")) as unknown as LightElement });
      if (outside) for (const listener of listeners.get("keydown") ?? []) listener(event);
      else (second.controller.overlay.callout.element as unknown as LightElement).dispatchEvent(event);
      second.take(`${outside ? "outside " : "card "}${value}`);
      return event;
    };
    expect(key("ArrowLeft").defaultPrevented).toBe(true);
    expect(key("ArrowRight").defaultPrevented).toBe(true);
    expect(second.controller.service.snapshot().active!.index).toBe(1);
    key("ArrowLeft"); expect(second.controller.service.snapshot().active!.index).toBe(0);
    key("Enter"); expect(second.controller.service.snapshot().active!.index).toBe(1);
    document.body.append(dialog); key("Escape", true);
    expect(second.controller.service.snapshot().active).not.toBeNull(); dialog.remove();
    expect(key("Escape", true).defaultPrevented).toBe(true);
    expect(second.controller.service.snapshot().active).toBeNull();
    expect(second.controller.status("onboarding")).toBe("skipped");
    second.controller.start("onboarding"); key("Escape");
    expect(second.controller.service.snapshot().active).toBeNull();
    expect(snapshotValue(states)).toMatchSnapshot("990ccb54 reload, dialogs and controller keys");
  } finally {
    if (oldNow) Object.defineProperty(performance, "now", oldNow); else delete (performance as unknown as Record<string, unknown>).now;
    globals.window = oldWindow; globals.requestAnimationFrame = oldRaf; uninstallLightDom();
  }
});
