import { expect, test } from "bun:test";
import { AuthoringDocument } from "../src/authoring-document";
import { AuthoringPreviewCoordinator, type CompleteRaster, type PreviewRenderPort } from "../src/authoring-preview-coordinator";
import { freshWorkspace } from "../src/workspace-state";

function harness() {
  const document = new AuthoringDocument(freshWorkspace());
  const calls: string[] = [];
  let maxTextureSize = 4096, queue = { queued: 0, running: null as object | null };
  let sizes = document.recipe.layers.map(() => 1);
  let opticsMissing = false, presentationMapsMissing = false;
  const port: PreviewRenderPort = {
    maxTextureSize: () => maxTextureSize,
    resourceSize: i => sizes[i] ?? 0,
    needsOptics: () => opticsMissing,
    needsPresentationMaps: () => presentationMapsMissing,
    queue: () => queue,
    reset: () => { calls.push("cancel"); },
    replaceResources: () => { calls.push("replace"); sizes = document.recipe.layers.map(() => 1); },
    releaseDisabled: i => { calls.push(`release:${i}`); sizes[i] = 1; },
    request: (i, _layer, priority, size, optics) => calls.push(`request:${i}:${priority}:${size}:${optics}`),
    updateLayer: i => { calls.push(`update:${i}`); },
    publish: result => { calls.push(`publish:${result.i}:${result.size}`); sizes[result.i] = result.size; },
    renderAll: order => { calls.push(`all:${order ?? "active-first"}`); },
    refresh: () => { calls.push("refresh"); },
    refreshQuality: () => { calls.push("quality"); },
    report: message => { calls.push(`status:${message}`); },
  };
  const coordinator = new AuthoringPreviewCoordinator(document, 1024, port);
  return { coordinator, document, calls, sizes, setMax: (size: number) => maxTextureSize = size,
    setQueue: (queued: number, running: object | null) => queue = { queued, running },
    setOptics: (missing: boolean) => opticsMissing = missing,
    setPresentationMaps: (missing: boolean) => presentationMapsMissing = missing };
}

test("quality tier changes cancel old work and release resources before rebuilding active-first", () => {
  const h = harness();
  expect(h.coordinator.quality.dispatch({ kind: "quality.set", size: 512 })).toBe(true);
  expect(h.coordinator.size).toBe(512);
  expect(h.calls).toEqual(["cancel", "replace", "all:active-first"]);
  h.calls.length = 0;
  h.coordinator.render(0);
  expect(h.calls).toContain("request:0:true:512:false");
  expect(h.calls.indexOf("request:0:true:512:false")).toBeLessThan(h.calls.indexOf("update:0"));
});

test("worker failure blocks publication until one full recovery rebuild", () => {
  const h = harness();
  h.coordinator.fail("Worker failed");
  expect(h.coordinator.quality.snapshot().blocked).toBe(true);
  h.calls.length = 0;
  h.coordinator.render(0);
  expect(h.calls).toEqual(["cancel", "all:active-first"]);
  expect(h.coordinator.quality.snapshot().blocked).toBe(false);
  expect(h.calls.some(call => call.startsWith("request:"))).toBe(false);
});

test("capacity failure cancels work and reports a persistent disabled reason", () => {
  const h = harness();
  h.setMax(256);
  h.coordinator.render(0);
  expect(h.calls[0]).toBe("cancel");
  expect(h.calls.some(call => call.startsWith("request:"))).toBe(false);
  expect(h.coordinator.quality.snapshot().blocked).toBe(true);
  expect(h.coordinator.describeQuality()).toBe(h.coordinator.quality.snapshot().error);
});

test("disabled slots release full resources and request only a 1px placeholder", () => {
  const h = harness();
  h.document.recipe.layers[0].enabled = false;
  h.coordinator.render(0);
  expect(h.calls.slice(0, 3)).toEqual(["release:0", "request:0:true:1:false", "update:0"]);
});

test("publication rejects obsolete quality and removed slots before touching renderer resources", () => {
  const h = harness();
  const result = (i: number, size: number): CompleteRaster => ({ i, size, ms: 3.2, version: 1,
    data: new Uint8ClampedArray(size * size * 4) });
  expect(h.coordinator.publish(result(0, 512))).toBe(false);
  expect(h.coordinator.publish(result(99, 1024))).toBe(false);
  expect(h.calls).toEqual([]);
  expect(h.coordinator.publish(result(0, 1024))).toBe(true);
  expect(h.calls[0]).toBe("publish:0:1024");
  expect(h.coordinator.lastRasterMs).toBe(3.2);
});

test("quality status reflects queue and texture readiness without knowing canvas or worker types", () => {
  const h = harness();
  const phases: string[] = [];
  const unsubscribe = h.coordinator.subscribe(() => phases.push(h.coordinator.readiness().phase));
  expect(h.coordinator.readiness()).toMatchObject({ phase: "updating", size: 1024, waiting: true });
  expect(h.coordinator.describeQuality()).toStartWith("Updating · 1024");
  h.coordinator.publish({ i: 0, size: 1024, ms: 1, version: 1,
    data: new Uint8ClampedArray(1024 * 1024 * 4) });
  expect(h.coordinator.readiness()).toMatchObject({ phase: "ready", size: 1024, waiting: false });
  expect(phases).toContain("ready");
  expect(h.coordinator.describeQuality()).toStartWith("Ready · 1024");
  h.setQueue(1, null);
  expect(h.coordinator.describeQuality()).toStartWith("Updating · 1024");
  h.setQueue(0, {});
  expect(h.coordinator.describeQuality()).toStartWith("Updating · 1024");
  h.setQueue(0, null); h.setPresentationMaps(true);
  expect(h.coordinator.describeQuality()).toStartWith("Updating · 1024");
  unsubscribe();
});
