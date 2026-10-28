import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Registry, type AnyOwner } from "../src/platform/core/registry";
import { createRegisteredPreview, noGeneratedPreview, type BrowserPreviewOptions } from "../src/preview/browser/preview-capabilities";
import { registeredPreviewPreparation } from "../src/preview/preview-capabilities";
import { STUDIO_COMPOSITION, STUDIO_OWNERS, STUDIO_REGISTRY } from "../src/compose/studio-registry";
import { createTrustedAuthoringCore } from "./fixtures/makeup-core";
import { buildBrowserHead } from "../src/preview/browser/browser-head-attachment";
import { ensurePreviewCore, previewCoreReadiness } from "../src/preview/host/preview-core-service";
import { PREVIEW_CORE_RECIPES, previewCoreRecipeSha256 } from "../src/preview/preview-core-recipe";
import { parseCoreDetail } from "../src/character/render-detail";
import { parseGlb } from "../src/formats/glb";
import { fakeUncook, fixturePlateRecipe, fixturePreviewRecipe } from "./preview-core-fixture";
import { freshWorkspace } from "./fixtures/eye-region";
import { harness } from "./fixtures/fake-heads";
import { tempDir } from "./temp-dir";

function options() {
  const life = new AbortController(), counts = { worker: 0, canvas: 0, paint: 0, stop: 0 }, requests: any[] = [];
  const worker = { onmessage: null as ((event: any) => void) | null, onerror: null,
    postMessage: (message: unknown) => { requests.push(message); }, terminate: () => { counts.stop++; } };
  const ports: BrowserPreviewOptions = { signal: life.signal, initialSize: 512, frame: run => run(), changed() {},
    refresh() {}, refreshSelection() {}, refreshQuality() {}, drawUV() {}, report() {},
    makeWorker: () => { counts.worker++; return worker; },
    createCanvas: size => { counts.canvas++; return { width: size, height: size,
      getContext: () => ({ putImageData: () => { counts.paint++; } }) } as unknown as HTMLCanvasElement; },
    createPixels: (data, size) => ({ data, width: size, height: size }) as ImageData };
  return { life, counts, worker, requests, ports };
}

test("without the feature, no makeup preview, raster, worker, canvas or plate preparation is made; the head prepares and draws", async () => {
  const registry = new Registry<AnyOwner>(STUDIO_OWNERS.filter(owner => owner.id !== "eye-makeup")), h = options();
  const core = { documents: { live: "eye-makeup" }, app: { actionRegistry: () => registry },
    get document() { throw Error("Absent feature's document read"); }, get geometry() { throw Error("Absent geometry read"); } };
  expect(createRegisteredPreview(core as never, h.ports)).toBeUndefined();
  for (const body of ["female", "male"] as const) expect(registeredPreviewPreparation(registry, body)).toBeUndefined();
  expect(noGeneratedPreview(512).readiness()).toEqual({ phase: "ready", size: 512, pending: 0, waiting: false, estimatedBytes: 0, layers: [] });
  expect(h.counts).toEqual({ worker: 0, canvas: 0, paint: 0, stop: 0 });
  const head = harness();
  let prepared = 0;
  const bare = await buildBrowserHead({ ...head.ports, layered: [], viewport: { ...head.ports.viewport,
    surfaceGuides() { throw Error("Unregistered guides prepared"); }, surfaceSteps() { throw Error("Unregistered surface prepared"); } } });
  head.scenes[0]!.known.prepare = async ({ signal, overlays, work }: any) => { signal.throwIfAborted(); expect(overlays).toBeUndefined(); expect(work).toBeUndefined(); prepared++; };
  await bare.prepare(h.life.signal, () => {});
  expect(prepared).toBe(1);
  bare.show();
  expect(bare.shown).toBe(true); expect(head.viewport.scene()).toBe(bare.scene); expect(head.host.canvases).toBe(1);
  bare.dispose(); h.life.abort();
  expect(head.host.canvases).toBe(0);
});

test("the registered raster/worker device follows AbortSignal and refuses an already captured late result", () => {
  const core = createTrustedAuthoringCore(freshWorkspace(), { resetStack: () => {}, selectedCollection: () => "test" }, STUDIO_COMPOSITION);
  const h = options(), device = createRegisteredPreview(core, h.ports)!;
  expect(device.feature).toBe("eye-makeup"); expect(h.counts.worker).toBe(0);
  device.start(); expect(h.counts.worker).toBe(1);
  const late = h.worker.onmessage!, request = h.requests.find(item => "layer" in item);
  h.life.abort(); expect(h.counts.stop).toBe(1); expect(h.worker.onmessage).toBeNull();
  late({ data: { i: request.i, version: request.version, size: request.size, ms: 1, data: new Uint8ClampedArray(request.size ** 2 * 4) } });
  expect(h.counts.paint).toBe(0);
  device.start(); expect(h.counts.worker).toBe(1);
  core.document.dispose();
});

test("each body's plate is contributed on its existing feature owner with the released identity", () => {
  for (const body of ["female", "male"] as const) {
    const { recipe, plate } = PREVIEW_CORE_RECIPES[body];
    expect(registeredPreviewPreparation(STUDIO_REGISTRY, body)).toEqual(plate);
    expect(previewCoreRecipeSha256(recipe, registeredPreviewPreparation(STUDIO_REGISTRY, body))).toBe(previewCoreRecipeSha256(recipe, plate));
    expect(registeredPreviewPreparation(new Registry<AnyOwner>([]), body)).toBeUndefined();
  }
});

test("abort during worker creation terminates that worker before it can receive a raster", () => {
  const core = createTrustedAuthoringCore(freshWorkspace(), { resetStack: () => {}, selectedCollection: () => "test" }, STUDIO_COMPOSITION);
  const h = options(), makeWorker = h.ports.makeWorker!;
  h.ports.makeWorker = () => { const worker = makeWorker(); h.life.abort(); return worker; };
  const device = createRegisteredPreview(core, h.ports)!;
  device.start();
  expect(h.counts.worker).toBe(1); expect(h.counts.stop).toBe(1); expect(h.requests).toEqual([]);
  expect(h.worker.onmessage).toBeNull(); core.document.dispose();
});

test("a deferred gesture frame does not read a released look after preview abort", () => {
  const core = createTrustedAuthoringCore(freshWorkspace(), { resetStack: () => {}, selectedCollection: () => "test" }, STUDIO_COMPOSITION);
  const h = options(), frames: (() => void)[] = [];
  h.ports.frame = run => { frames.push(run); };
  createRegisteredPreview(core, h.ports);
  core.document.gestureChanged(0, "point.move");
  expect(frames).toHaveLength(1);
  h.life.abort(); core.document.dispose();
  for (const frame of frames) expect(frame).not.toThrow();
  expect(h.counts.worker).toBe(0);
});

test("head-only derivation cuts no eye plate, keeps real head/eyes, and has an independent reusable cache", async () => {
  const root = tempDir("xfs-head-only-"), game = join(root, "game"), cacheRoot = join(root, "cache");
  mkdirSync(join(game, "archive/pc/content"), { recursive: true }); writeFileSync(join(game, "archive/pc/content/base.archive"), "fixture");
  const plate = fixturePlateRecipe(), recipe = { ...fixturePreviewRecipe(plate), source: plate.source };
  const fake = fakeUncook(plate, recipe), exporter = fake.exporter(join(root, "exports"));
  const derived = await ensurePreviewCore({ gameRoot: game, cacheRoot, recipe, exporter });
  const json = parseGlb(readFileSync(join(derived.directory, "head.glb"))).json;
  expect(json.nodes.filter((node: any) => node.mesh !== undefined).map((node: any) => node.name)).toEqual(["head", "eyes"]);
  expect(derived.manifest.geometry.head).toMatchObject({ vertices: 25, triangles: 32, morphTargets: 2 });
  expect(derived.manifest.geometry.plate).toEqual({ vertices: 0, triangles: 0, morphTargets: 0 });
  expect(derived.manifest).not.toHaveProperty("plateRecipeId");
  const record = parseCoreDetail(JSON.parse(readFileSync(join(derived.directory, "preview-core.json"), "utf8")));
  expect(record.geometry.nodes).toEqual({ head: "head", eyes: "eyes" });
  expect(record.geometry.morphs.map(item => item.node)).toEqual(["head", "eyes"]);
  expect(previewCoreReadiness(cacheRoot, game, recipe).state).toBe("ready");
  expect(previewCoreReadiness(cacheRoot, game, recipe, plate).state).toBe("none");
  const again = await ensurePreviewCore({ gameRoot: game, cacheRoot, recipe, exporter });
  expect(again.reused).toBe(true); expect(again.manifest).toEqual(derived.manifest);
  const withPlate = await ensurePreviewCore({ gameRoot: game, cacheRoot, recipe, exporter, plateRecipe: plate });
  expect(withPlate.manifest.cacheKey).not.toBe(derived.manifest.cacheKey);
  expect(previewCoreReadiness(cacheRoot, game, recipe).state).toBe("ready");
}, 30_000);

test("a synthetic registered preview is substituted without touching the core or makeup source", () => {
  const h = options(), feature = STUDIO_OWNERS.find(owner => owner.id === "eye-makeup")!;
  let called = 0;
  const value = { feature: "synthetic-preview" };
  const owner = { ...feature, preview: { create(state: unknown, given: unknown) {
    expect(state).toBe(core); expect(given).toBe(h.ports); called++; return value;
  } } };
  const registry = new Registry<AnyOwner>([owner]);
  const core = { documents: { live: feature.id }, app: { actionRegistry: () => registry } };
  expect(createRegisteredPreview(core as never, h.ports)).toBe(value as never); expect(called).toBe(1);
  expect(h.counts.worker).toBe(0); h.life.abort();
});
