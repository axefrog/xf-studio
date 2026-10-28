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
import { installLightDom, uninstallLightDom } from "./light-dom";

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
    for (const anchor of ["visible", "hidden", "missing"] as const) for (const tour of tours) {
      const facts: GuidanceFacts = { layers: 1, activeLayer: "a", finish: "matte", color: "#905774", edit: "1:0:s1", presets: 1,
        lighting: "studio", visiblePanels: [...PANEL_IDS], writable, setup, package: "none", lastPackage: "", installed: 0 };
      const recorded: unknown[] = [];
      const env: GuidanceEnvironment = { facts: () => facts, anchor: () => anchor, panelVisible: () => anchor !== "missing",
        anchorInfo: id => anchors.find(info => info.id === id),
        panelTitle: id => (PANEL_META as Record<string, { title: string }>)[id]?.title ?? id, capability: () => ({ available: true }), record: (...args) => recorded.push(args) };
      const service = new GuidanceService(tours, env), states: unknown[] = [];
      service.dispatch({ kind: "guidance.startTour", tourId: tour.id });
      for (let guard = 0; guard < 30 && service.snapshot().active; guard++) {
        const active = service.snapshot().active!;
        states.push({ ...active, tour: active.tour.id });
        service.dispatch({ kind: "guidance.next" });
      }
      expect(service.snapshot().active).toBeNull();
      service.dispatch({ kind: "guidance.startTour", tourId: tour.id });
      service.dispatch({ kind: "guidance.next" }); service.dispatch({ kind: "guidance.back" });
      const back = service.snapshot().active;
      service.dispatch({ kind: "guidance.skip" });
      walks.push({ writable, setup, anchor, tour: tour.id, states, back: back && { ...back, tour: back.tour.id }, recorded, last: service.snapshot().last });
    }
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
