import { expect, test } from "bun:test";
import { AuthoringDocument } from "../src/authoring-document";
import { createBrowserPreviewDevice } from "../src/browser-preview-device";
import type { RasterPort } from "../src/raster-client";
import type { createScene } from "../src/scene";
import { freshWorkspace } from "../src/workspace-state";
import { editLayers } from "../src/layer-stack";
import type { RasterRequest } from "../src/raster-processor";

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
  const device = createBrowserPreviewDevice({
    document: authoring, initialSize: 512, makeWorker: () => worker,
    frame: run => run(), refresh: () => {}, refreshSelection: () => {},
    refreshQuality: () => {}, drawUV: () => {}, report: () => {}, measurement: () => {},
    createCanvas, createPixels: (data, size) => ({ data, width: size, height: size }) as ImageData,
  });
  const mask = new Uint8ClampedArray(512 * 512 * 4);
  expect(device.coordinator.publish({ i: 0, size: 512, version: 1, ms: 2, data: mask })).toBe(true);
  expect(device.canvases[0].width).toBe(512);
  expect(events).toContain("paint:512");
  const scene = {
    renderer: { capabilities: { maxTextureSize: 4096 } },
    needsOptics: () => false, needsAlbedo: () => false,
    setLayerCanvases: (canvases: HTMLCanvasElement[]) => events.push(`stack:${canvases[0].width}`),
    setLayerCanvas: () => {}, updateLayer: (i: number) => events.push(`layer:${i}`),
  } as unknown as Awaited<ReturnType<typeof createScene>>;
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
  const device = createBrowserPreviewDevice({
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
  device.coordinator.render(2);
  expect(sent).toHaveLength(1);
  const pending = sent[0];
  const back = editLayers(moved, id, { kind: "move", id, to: 0 }).recipe;
  authoring.replaceRecipe(back, 0);
  device.coordinator.syncStack(moved);
  expect(cancelled).toEqual([pending.version]);
  worker.onmessage!({ data: { i: 2, version: pending.version, size: 512, ms: 1,
    data: completed } } as MessageEvent);
  expect(device.canvases[0]).toBe(canvas);
  expect(device.queueDiagnostics().discarded).toBe(1);
});
