/** Frozen from 2afdbe8d: initial pre-edit capture, corrected mottle recaptured only from its archive. Never update from the refactor. */
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensurePreviewCore } from "../src/preview/host/preview-core-service";
import { createRasterProcessor, type RasterResponse } from "../src/engines/layered-makeup/raster-processor";
import { createRegisteredPreview } from "../src/preview/browser/preview-capabilities";
import { STUDIO_REGISTRY } from "../src/compose/studio-registry";
import type { LayeredMakeupSurface } from "../src/engines/layered-makeup/render/makeup-stack";
import { AuthoringDocument } from "./fixtures/makeup-document";
import { EYE_RASTER_REGION, freshWorkspace, initialRecipe } from "./fixtures/eye-region";
import { fakeUncook, fixturePlateRecipe, fixturePreviewRecipe } from "./preview-core-fixture";
import { tempDir } from "./temp-dir";

const hash = (bytes: Uint8Array | Uint8ClampedArray) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const referenceFile = new URL("../data/raster-user-after.json", import.meta.url);
test.skipIf(!existsSync(referenceFile))("all six private reference worker rasters retain their captured hashes", async () => {
  const { records } = JSON.parse(readFileSync(referenceFile, "utf8")) as { records: {
    size: number; sha256: string; layer: ReturnType<typeof initialRecipe>["layers"][number] }[] };
  expect(records).toHaveLength(6);
  for (const [index, record] of records.entries()) {
    let result: RasterResponse | undefined;
    const start = performance.now();
    const processor = createRasterProcessor(value => { result = value; }, async () => {}, () => 0);
    await processor.start({ i: 0, version: 1, layer: record.layer, size: record.size, region: EYE_RASTER_REGION });
    expect(result && "data" in result).toBe(true);
    if (result && "data" in result) {
      const actual = hash(result.data);
      console.log(`reference ${index + 1}: ${record.size}, ${actual}, ${(performance.now() - start).toFixed(1)} ms`);
      expect(actual).toBe(record.sha256);
    }
  }
}, 30_000);
test("registered head preparation preserves every 2afdbe8d output byte and identity", async () => {
  const root = tempDir("xfs-core-preview-parity-"), game = join(root, "game");
  mkdirSync(join(game, "archive/pc/content"), { recursive: true });
  writeFileSync(join(game, "archive/pc/content/fixture.archive"), "fixture");
  const plate = fixturePlateRecipe(), recipe = fixturePreviewRecipe(plate);
  const result = await ensurePreviewCore({ gameRoot: game, cacheRoot: join(root, "cache"),
    exporter: fakeUncook(plate, recipe).exporter(join(root, "exports")), recipe, plateRecipe: plate });
  expect({ manifest: result.manifest, files: result.manifest.files.map(file => ({ ...file,
    sha256: hash(readFileSync(join(result.directory, file.name))) })) }).toMatchSnapshot();
}, 30_000);

test("2afdbe8d raster worker bytes survive registration, including 2K and mottle", async () => {
  const base = initialRecipe().layers[0], varied = structuredClone(base);
  varied.points.forEach((point, i) => { point.weight = i / varied.points.length; point.feather = .001 + i * .008; });
  varied.softness = { mode: "boundary", blend: .0000078125 };
  varied.fields[0].du = .015; varied.fields[0].dv = -.008;
  const mottled = structuredClone(varied);
  // Use the released preset parser/defaults rather than a new raster configuration.
  const { mottlePreset } = await import("../src/engines/layered-makeup/mottle");
  mottled.effects = { mottle: mottlePreset("powder", 103) };
  const output: unknown[] = [];
  for (const [name, layer] of [["plain", base], ["directional", varied], ["mottle", mottled]] as const) {
    for (const size of [512, 2048]) {
      let result: RasterResponse | undefined;
      const processor = createRasterProcessor(value => { result = value; }, async () => {}, () => 0);
      await processor.start({ i: 0, version: 1, layer, size, region: EYE_RASTER_REGION });
      expect(result && "data" in result).toBe(true);
      if (result && "data" in result) output.push({ name, size, bytes: result.data.byteLength, sha256: hash(result.data) });
    }
  }
  expect(output).toMatchSnapshot();
}, 30_000);

test("2afdbe8d preview presentation, warm holds and superseded worker results stay identical", () => {
  const document = new AuthoringDocument(freshWorkspace()), events: unknown[] = [], requests: any[] = [];
  const worker = { onmessage: null as any, onerror: null, postMessage: (message: any) => {
    events.push("layer" in message ? ["request", message.i, message.version, message.size] : ["cancel", message.cancel]);
    if ("layer" in message) requests.push(message);
  }, terminate: () => events.push("terminate") };
  const life = new AbortController();
  const core = { document, documents: { live: "eye-makeup" }, app: { actionRegistry: () => STUDIO_REGISTRY } };
  const device = createRegisteredPreview(core as never, { signal: life.signal, changed: () => {}, initialSize: 512, look: () => "look:A",
    makeWorker: () => worker, frame: run => run(), refresh: () => {}, refreshSelection: () => {}, refreshQuality: () => {},
    drawUV: () => {}, report: text => events.push(["report", text]),
    createCanvas: size => ({ width: size, height: size, getContext: () => ({ putImageData: () => events.push(["paint", size]) }) }) as any,
    createPixels: (data, size) => ({ data, width: size, height: size }) as ImageData })!;
  const scene = { maxTextureSize: 4096, surface: {}, layers: { needsOptics: () => false, needsAlbedo: () => false,
    setCanvases: (canvases: HTMLCanvasElement[], ids: string[]) => events.push(["stack", canvases.map(c => c.width), ids]),
    setLayerCanvas: (i: number, canvas: HTMLCanvasElement) => events.push(["canvas", i, canvas.width]),
    updateLayer: (i: number) => events.push(["layer", i]),
  } } as unknown as LayeredMakeupSurface;
  device.coordinator.render(0);
  const respond = (request: any) => worker.onmessage({ data: { i: request.i, version: request.version,
    size: request.size, ms: 2, data: new Uint8ClampedArray(request.size ** 2 * 4) } });
  respond(requests[0]);
  device.fillScene(scene); events.push(["prepared", device.holdsCurrent(scene)]);
  device.connectScene(scene); device.presentInitialLayers(); device.disconnectScene(scene);
  events.push(["warm", device.showLook()]);
  const layer = structuredClone(document.recipe); layer.layers[0].opacity = .4;
  document.publishLayer(layer, 0);
  device.coordinator.quality.dispatch({ kind: "quality.set", size: 1024 });
  respond(requests[1]);
  events.push(["discarded", device.queueDiagnostics().discarded]);
  device.releaseScene(scene);
  expect(events).toMatchSnapshot();
  life.abort(); document.dispose();
});
