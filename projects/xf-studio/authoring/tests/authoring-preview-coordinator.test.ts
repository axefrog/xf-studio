import { expect, test } from "bun:test";
import { AuthoringDocument } from "../src/authoring-document";
import { AuthoringPreviewCoordinator, type CompleteRaster, type PreviewRenderPort } from "../src/authoring-preview-coordinator";
import { freshWorkspace, editLayers } from "./fixtures/eye-region";

function harness() {
  const document = new AuthoringDocument(freshWorkspace());
  const calls: string[] = [];
  let maxTextureSize = 4096, queue: { queued: number; running: object | null; queuedIndices?: number[] } = { queued: 0, running: null };
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
    reconcileResources: (previous, current) => {
      calls.push("reconcile");
      const old = new Map(previous.map((layer, i) => [layer.id, sizes[i]]));
      sizes = current.map(layer => old.get(layer.id) ?? 1);
      return new Set<string>();
    },
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
  return { coordinator, document, calls, get sizes() { return sizes; }, setMax: (size: number) => maxTextureSize = size,
    setQueue: (queued: number, running: object | null) => queue = { queued, running },
    setQueueDetail: (value: typeof queue) => queue = value,
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

test("rename and its Undo keep completed textures; move reuses them by identity; colour Undo rerenders only its layer", () => {
  const h = harness();
  h.sizes.fill(1024);
  const original = h.document.recipe;
  const id = original.layers[0].id;
  const renamed = editLayers(original, id, { kind: "rename", id, name: "Renamed" }).recipe;
  h.document.replaceRecipe(renamed, 0);
  h.coordinator.syncStack(original);
  expect(h.calls).toEqual(["refresh"]);
  h.calls.length = 0;
  h.document.replaceRecipe(original, 0);
  h.coordinator.syncStack(renamed);
  expect(h.calls).toEqual(["refresh"]);
  h.calls.length = 0;
  const moved = editLayers(original, id, { kind: "move", id, to: 2 }).recipe;
  h.document.replaceRecipe(moved, 2);
  h.coordinator.syncStack(original);
  expect(h.calls).toEqual(["reconcile", "refresh"]);
  expect(h.sizes).toEqual([1024, 1024, 1024, 1024]);
  h.calls.length = 0;
  const recolored = structuredClone(moved);
  recolored.layers[2].color = "#123456";
  h.document.replaceRecipe(recolored, 2);
  h.coordinator.syncStack(moved);
  expect(h.calls.filter(call => call.startsWith("request:"))).toEqual(["request:2:true:1024:false"]);
  h.calls.length = 0;
  h.document.replaceRecipe(moved, 2);
  h.coordinator.syncStack(recolored);
  expect(h.calls.filter(call => call.startsWith("request:"))).toEqual(["request:2:true:1024:false"]);
  h.calls.length = 0;
  const reshaped = structuredClone(moved);
  reshaped.layers[2].points[0].u += .001;
  h.document.replaceRecipe(reshaped, 2);
  h.coordinator.syncStack(moved);
  expect(h.calls.filter(call => call.startsWith("request:"))).toEqual(["request:2:true:1024:false"]);
});

test("reordering restarts only unfinished slots after cancelling their old index requests", () => {
  const h = harness();
  h.sizes.splice(0, h.sizes.length, 1024, 1, 1024, 1024);
  const original = h.document.recipe, id = original.layers[0].id;
  original.layers[1].enabled = true;
  const moved = editLayers(original, id, { kind: "move", id, to: 2 }).recipe;
  h.document.replaceRecipe(moved, 2);
  h.coordinator.syncStack(original);
  expect(h.calls.filter(call => call.startsWith("request:"))).toEqual(["request:0:false:1024:false"]);
});

test("duplicating a layer queues its new ID without rebuilding completed siblings", () => {
  const h = harness();
  h.sizes.fill(1024);
  const original = h.document.recipe, id = original.layers[0].id;
  const copied = editLayers(original, id, { kind: "duplicate", id, newId: "copied-layer" }).recipe;
  h.document.replaceRecipe(copied, 1);
  h.coordinator.syncStack(original);
  expect(h.calls.filter(call => call.startsWith("request:"))).toEqual(["request:1:true:1024:false"]);
  expect(h.sizes).toEqual([1024, 1, 1024, 1024, 1024]);
});

test("per-layer readiness attributes queued, running, stale-tier and disabled slots", () => {
  const h = harness(), ids = h.document.recipe.layers.map(layer => layer.id);
  for (const layer of h.document.recipe.layers) layer.enabled = true;
  for (let i = 0; i < ids.length; i++) h.coordinator.publish({ i, size: 1024, ms: 1, version: 1, data: new Uint8ClampedArray(1024 * 1024 * 4) });
  expect(h.coordinator.readiness().layers.map(layer => layer.state)).toEqual(["ready", "ready", "ready", "ready"]);
  h.setQueue(1, { i: 2 });
  // Without slot indices the queue cannot attribute work, so every enabled layer is updating.
  expect(h.coordinator.readiness().layers.every(layer => layer.state === "updating")).toBe(true);
  h.setQueueDetail({ queued: 1, running: { i: 2 }, queuedIndices: [0] });
  expect(h.coordinator.readiness().layers.map(layer => layer.state)).toEqual(["updating", "ready", "updating", "ready"]);
  h.setQueueDetail({ queued: 0, running: null, queuedIndices: [] });
  h.document.recipe.layers[3].enabled = false;
  h.sizes[1] = 512;
  expect(h.coordinator.readiness().layers).toEqual([
    { layerId: ids[0], state: "ready", size: 1024 }, { layerId: ids[1], state: "updating", size: 512 },
    { layerId: ids[2], state: "ready", size: 1024 }, { layerId: ids[3], state: "disabled", size: 1024 }]);
  h.setMax(256);
  expect(h.coordinator.readiness().layers.slice(0, 3).every(layer => layer.state === "blocked")).toBe(true);
});
