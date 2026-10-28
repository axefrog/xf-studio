import { expect, test } from "bun:test";
import { StudioRuntime, type Frame, type Port } from "../src/studio-ui/runtime";
import { mountGuidance, guidanceFacts } from "../src/studio-ui/guidance/controller";
import { guidanceContents } from "../src/studio-ui/guidance/contributions";
import { helpPanel } from "../src/studio-ui/guidance/help-panel";
import { STUDIO_CATALOGUE } from "../src/compose/views";
import { viewCatalogue } from "../src/studio-ui/views/contribution";
import type { GuidanceContribution } from "../src/studio-ui/guidance/contributions";
import type { Feedback } from "../src/studio-ui/feedback";
import { trustedFixture } from "./studio-presentation-fixture";
import { installLightDom, uninstallLightDom } from "./light-dom";

function dom(run: () => void) {
  installLightDom();
  const globals = globalThis as unknown as Record<string, unknown>, oldWindow = globals.window, oldRaf = globals.requestAnimationFrame;
  // Each isolated page needs a distinct document identity for the overlay's document-scoped modality listeners.
  globals.document = new Proxy(document, {});
  globals.window = { innerWidth: 1200, innerHeight: 800, addEventListener() {}, removeEventListener() {} };
  globals.requestAnimationFrame = () => 0;
  try { run(); } finally { globals.window = oldWindow; globals.requestAnimationFrame = oldRaf; uninstallLightDom(); }
}
const frame = { status: { verification: false }, preferences: {}, previewSetup: { card: { open: false, canDismiss: false } } } as unknown as Frame;
const feedback = (): Feedback => ({ announce() {}, toast() {}, record() {} }) as unknown as Feedback;

test("zero-feature guidance and Help run without a makeup facade, tours, topics, input reference or offer", () => dom(() => {
  const { shell } = trustedFixture();
  let lookups = 0;
  const port = { ...shell, features: () => [], feature() { lookups++; throw Error("No feature facade"); } } as unknown as Port;
  const rt = new StudioRuntime(port, feedback());
  rt.dock = { isVisible: () => false } as unknown as StudioRuntime["dock"];
  const controller = mountGuidance(rt, { openHelp() {} }), help = helpPanel(rt, { tours: () => controller.service.tourList(), status: controller.status, start: controller.start });
  document.body.append(...controller.elements, help.spec.element);
  controller.offerOnboarding(frame); controller.update(frame); help.update(frame);
  expect(guidanceContents(rt)).toEqual([]);
  expect(guidanceFacts(rt)).toMatchObject({ layers: 0, activeLayer: null, finish: null, color: null });
  expect(controller.service.tourList()).toEqual([]);
  expect(controller.commands().map(command => command.id)).toEqual(["help.open"]);
  expect(controller.offer.element.hidden).toBe(true);
  expect(help.spec.element.querySelectorAll(".help-topic")).toHaveLength(0);
  expect(help.spec.element.querySelectorAll(".reference-section")).toHaveLength(0);
  expect(document.body.textContent).not.toMatch(/makeup|Bézier|pigment|warp/i);
  expect(rt.anchors.info("layers.add")).toBeUndefined();
  expect("editor" in rt).toBe(false); expect("finishes" in rt).toBe(false);
  expect(lookups).toBe(0);
}));

test("feature and view withdrawal release anchors independently, stop a tour and remove rendered Help", () => dom(() => {
  const { shell } = trustedFixture(), first = new AbortController(), second = new AbortController();
  let active = true, lookups = 0;
  const port = { ...shell, features: () => active ? shell.features() : [], feature(id: string) {
    if (!active) throw Error("Withdrawn facade accessed"); lookups++; return shell.feature(id);
  } } as unknown as Port;
  const rt = new StudioRuntime(port, feedback(), STUDIO_CATALOGUE);
  rt.dock = { isVisible: () => true } as unknown as StudioRuntime["dock"];
  const controller = mountGuidance(rt, { openHelp() {} }), help = helpPanel(rt, { tours: () => controller.service.tourList(), status: controller.status, start: controller.start });
  document.body.append(...controller.elements, help.spec.element); help.update(frame);
  expect(help.spec.element.querySelectorAll(".help-topic").length).toBeGreaterThan(0);
  const element = { isConnected: true, getBoundingClientRect: () => ({ left: 0, top: 0, width: 50, height: 50 }) } as unknown as HTMLElement;
  const a = rt.anchors.scoped("first", first.signal), b = rt.anchors.scoped("second", second.signal);
  a.register("layers.add", element); b.register("layers.add", element);
  first.abort(); expect(rt.anchors.state("layers.add")).toBe("visible");
  second.abort(); expect(rt.anchors.state("layers.add")).toBe("missing");
  rt.anchors.register("finish.picker", element); rt.anchors.register("panel.layers", element);
  expect(controller.start("first-eye-mod")).toBe(true);
  expect(controller.service.snapshot().active).not.toBeNull();
  const before = lookups;
  active = false;
  controller.update(frame); help.update(frame);
  expect(lookups).toBe(before);
  expect(rt.anchors.registered()).not.toContain("finish.picker");
  expect(rt.anchors.registered()).not.toContain("panel.layers");
  expect(controller.service.snapshot()).toMatchObject({ active: null, last: { tourId: "first-eye-mod", outcome: "skipped" } });
  expect(controller.service.tourList()).toEqual([]);
  expect(help.spec.element.querySelectorAll(".help-topic")).toHaveLength(0);
  expect(help.spec.element.querySelectorAll(".reference-section")).toHaveLength(0);
  expect(() => a.register("layers.add", element)).not.toThrow();
  active = true;
  expect(rt.anchors.state("finish.picker")).toBe("missing");
  controller.update(frame); help.update(frame);
  expect(controller.service.tourList().length).toBeGreaterThan(0);
  expect(help.spec.element.querySelectorAll(".help-topic").length).toBeGreaterThan(0);
}));

test("a synthetic view supplies guidance through its own facade and creates text only once per live contribution", () => {
  const { shell } = trustedFixture();
  let active = true, creates = 0;
  const facade = {};
  const contribution: GuidanceContribution = { anchors: [], create(input) {
    expect(input).toBe(facade as never); creates++;
    return { tours: [], topics: [{ id: "synthetic", title: "Synthetic", body: "Synthetic help.", keywords: "synthetic" }] };
  } };
  const views = viewCatalogue([{ owner: "synthetic", panels: [], activity: [], guidance: contribution }]);
  const port = { ...shell, features: () => active ? [{ id: "synthetic" }] : [], feature: () => facade } as unknown as Port;
  const rt = new StudioRuntime(port, feedback(), views);
  expect(guidanceContents(rt)[0].topics[0].title).toBe("Synthetic");
  expect(guidanceContents(rt)[0].topics[0].title).toBe("Synthetic");
  expect(creates).toBe(1);
  active = false; expect(guidanceContents(rt)).toEqual([]);
  active = true; expect(guidanceContents(rt)).toHaveLength(1); expect(creates).toBe(2);
});
