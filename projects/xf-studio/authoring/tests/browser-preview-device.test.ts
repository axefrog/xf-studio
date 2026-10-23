import { expect, test } from "bun:test";
import { AuthoringDocument } from "../src/app/authoring/authoring-document";
import { createBrowserPreviewDevice } from "../src/legacy/eye-makeup/browser/browser-preview-device";
import type { RasterPort } from "../src/legacy/eye-makeup/browser/raster-client";
import type { LayeredMakeupSurface } from "../src/engines/layered-makeup/render/makeup-stack";
import type { RasterRequest } from "../src/engines/layered-makeup/raster-processor";
import { freshWorkspace, editLayers, EYE_RASTER_REGION } from "./fixtures/eye-region";

test("browser preview keeps completed masks before scene load and releases old canvases before a quality rebuild", () => {
  const authoring = new AuthoringDocument(freshWorkspace());
  const events: string[] = [];
  const worker: RasterPort = {
    onmessage: null, onerror: null,
    postMessage(message) { events.push("layer" in message ? "request" : "cancel"); },
    terminate() { events.push("terminate"); },
  };
  const createCanvas = (size: number) => ({
    width: size, height: size,
    getContext: () => ({ putImageData: () => events.push(`paint:${size}`) }),
  }) as unknown as HTMLCanvasElement;
  const device = createBrowserPreviewDevice({ region: EYE_RASTER_REGION,
    document: authoring, initialSize: 512, makeWorker: () => worker,
    frame: run => run(), refresh: () => {}, refreshSelection: () => {},
    refreshQuality: () => {}, drawUV: () => {}, report: () => {}, measurement: () => {},
    createCanvas, createPixels: (data, size) => ({ data, width: size, height: size }) as ImageData,
  });
  const mask = new Uint8ClampedArray(512 * 512 * 4);
  expect(device.coordinator.publish({ i: 0, size: 512, version: 1, ms: 2, data: mask })).toBe(true);
  expect(device.canvases[0].width).toBe(512);
  expect(events).toContain("paint:512");
  const scene = { maxTextureSize: 4096, surface: {}, layers: {
    needsOptics: () => false, needsAlbedo: () => false,
    setCanvases: (canvases: HTMLCanvasElement[]) => events.push(`stack:${canvases[0].width}`),
    setLayerCanvas: () => {}, updateLayer: (i: number) => events.push(`layer:${i}`),
  } } as unknown as LayeredMakeupSurface;
  device.connectScene(scene);
  device.presentInitialLayers();
  expect(events.indexOf("stack:512")).toBeLessThan(events.indexOf("layer:0"));
  expect(device.coordinator.describeQuality()).toStartWith("Ready · 512");
  events.length = 0;
  device.coordinator.quality.dispatch({ kind: "quality.set", size: 1024 });
  expect(device.canvases[0].width).toBe(1);
  expect(events.indexOf("stack:1")).toBeLessThan(events.indexOf("request"));
  expect(device.coordinator.describeQuality()).toStartWith("Updating · 1024");
});

test("a moved layer keeps its completed canvas and rejects a worker result for its old slot", () => {
  const authoring = new AuthoringDocument(freshWorkspace());
  const sent: RasterRequest[] = [], cancelled: number[] = [];
  const worker: RasterPort = {
    onmessage: null, onerror: null,
    postMessage(message) {
      if ("cancel" in message) cancelled.push(message.cancel);
      else sent.push(message);
    }, terminate() {},
  };
  const device = createBrowserPreviewDevice({ region: EYE_RASTER_REGION,
    document: authoring, initialSize: 512, makeWorker: () => worker,
    frame: run => run(), refresh: () => {}, refreshSelection: () => {},
    refreshQuality: () => {}, drawUV: () => {}, report: () => {}, measurement: () => {},
    createCanvas: size => ({ width: size, height: size,
      getContext: () => ({ putImageData: () => {} }) }) as unknown as HTMLCanvasElement,
    createPixels: (data, size) => ({ data, width: size, height: size }) as ImageData,
  });
  const completed = new Uint8ClampedArray(512 * 512 * 4);
  device.coordinator.publish({ i: 0, size: 512, version: 1, ms: 1, data: completed });
  const canvas = device.canvases[0], prior = authoring.recipe;
  const id = prior.layers[0].id;
  const moved = editLayers(prior, id, { kind: "move", id, to: 2 }).recipe;
  authoring.replaceRecipe(moved, 2);
  device.coordinator.syncStack(prior);
  expect(device.canvases[2]).toBe(canvas);
  expect(sent).toHaveLength(0);
  const recolored = structuredClone(moved);
  recolored.layers[2].color = "#123456";
  authoring.publishLayer(recolored, 2);
  expect(sent).toHaveLength(1);
  const pending = sent[0];
  const back = editLayers(recolored, id, { kind: "move", id, to: 0 }).recipe;
  authoring.replaceRecipe(back, 0);
  device.coordinator.syncStack(recolored);
  expect(cancelled).toEqual([pending.version]);
  expect(device.coordinator.readiness().phase).toBe("updating");
  worker.onmessage!({ data: { i: 2, version: pending.version, size: 512, ms: 1,
    data: completed } } as MessageEvent);
  expect(device.canvases[0]).toBe(canvas);
  expect(device.queueDiagnostics().discarded).toBe(1);
  expect(sent).toHaveLength(2);
  expect(sent[1].i).toBe(0);
  expect(sent[1].version).toBeGreaterThan(pending.version);
  expect(device.coordinator.readiness().phase).toBe("updating");
  worker.onmessage!({ data: { i: 0, version: sent[1].version, size: 512, ms: 1,
    data: completed } } as MessageEvent);
  expect(device.queueDiagnostics().completed).toBe(1);
  expect(device.coordinator.readiness().phase).toBe("ready");
});

for (const completed of [true, false]) test(`adopting a hold rerasterizes a ${completed ? "stale" : "never completed"} slot and keeps completed siblings`, () => {
  const authoring = new AuthoringDocument(freshWorkspace());
  const sent: RasterRequest[] = [];
  const worker: RasterPort = { onmessage: null, onerror: null, terminate() {},
    postMessage(message) { if (!("cancel" in message)) sent.push(message); } };
  let answered = 0, look = "A";
  const drain = () => {
    while (answered < sent.length) {
      const request = sent[answered++]!;
      worker.onmessage!({ data: { i: request.i, version: request.version, size: request.size, ms: 1,
        data: new Uint8ClampedArray(request.size * request.size * 4) } } as MessageEvent);
    }
  };
  const device = createBrowserPreviewDevice({ region: EYE_RASTER_REGION,
    document: authoring, look: () => look, initialSize: 512, makeWorker: () => worker,
    frame: run => run(), refresh() {}, refreshSelection() {}, refreshQuality() {}, drawUV() {}, report() {}, measurement() {},
    createCanvas: size => ({ width: size, height: size, getContext: () => ({ putImageData() {} }) }) as unknown as HTMLCanvasElement,
    createPixels: (data, size) => ({ data, width: size, height: size }) as ImageData,
  });
  // Two enabled masks; the sibling is complete and must survive adoption without new work.
  const initial = structuredClone(authoring.recipe);
  initial.layers[1]!.enabled = true;
  authoring.replaceRecipe(initial);
  for (let i = completed ? 0 : 1; i < initial.layers.length; i++) {
    const size = initial.layers[i]!.enabled ? 512 : 1;
    device.coordinator.publish({ i, size, version: 1, ms: 1, data: new Uint8ClampedArray(size * size * 4) });
  }
  const scene = { maxTextureSize: 4096, layers: {
    needsOptics: () => false, needsAlbedo: () => false,
    setCanvases() {}, setLayerCanvas() {}, updateLayer() {},
  } } as unknown as LayeredMakeupSurface;
  device.connectScene(scene); device.presentInitialLayers();
  const before = [...device.canvases];
  const edited = structuredClone(authoring.recipe);
  edited.layers[0]!.points[0]!.u += 0.01;
  authoring.publishLayer(edited, 0);
  expect(sent).toHaveLength(1);
  // Leave A while its new mask is in flight. Its hold has the edited layer and the old (or empty) canvas.
  device.disconnectScene(scene);
  look = "B";
  authoring.replaceRecipe({ ...edited, layers: edited.layers.map(layer => ({ ...layer, id: `b-${layer.id}` })) });
  expect(device.showLook()).toBe(false);
  drain(); // A's late response is discarded; B finishes.
  expect(device.queueDiagnostics().discarded).toBe(1);
  look = "A";
  authoring.replaceRecipe(edited);
  const requests = sent.length;
  expect(device.showLook()).toBe(true);
  expect(sent.slice(requests).map(request => request.i)).toEqual([0]);
  expect(sent[requests]!.layer.points).toEqual(edited.layers[0]!.points);
  expect(device.coordinator.readiness().layers[0]!.state).toBe("updating");
  expect(device.canvases[1]).toBe(before[1]);
  drain();
  expect(device.coordinator.readiness().phase).toBe("ready");
  expect(device.canvases[0]).not.toBe(before[0]);
  expect(device.canvases[1]).toBe(before[1]);
  expect(sent).toHaveLength(requests + 1);
  device.releaseScene(scene);
});
