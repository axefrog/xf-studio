import { expect, test } from "bun:test";
import { AuthoringDocument } from "../src/authoring-document";
import { createBrowserPreviewDevice } from "../src/browser-preview-device";
import type { RasterPort } from "../src/raster-client";
import type { createScene } from "../src/scene";
import { freshWorkspace } from "../src/workspace-state";

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
