/** Portable/file baselines captured on 1a6cdc80 before slice 11. Never update from the refactor. */
import { expect, test } from "bun:test";
import { StudioFileOperations, type StudioPickedFile } from "../src/app/studio-file-operations";
import { createBrowserFileDevice, registeredMaskBake } from "../src/app/browser/browser-file-device";
import { makeupFileOperations } from "../src/app/authoring/makeup-files";
import { STUDIO_REGISTRY } from "../src/compose/studio-registry";
import { createRasterProcessor, type RasterRequest, type RasterResponse } from "../src/engines/layered-makeup/raster-processor";
import { mottlePreset } from "../src/engines/layered-makeup/mottle";
import { defaultDirectGlintFlakes } from "../src/engines/layered-makeup/direct-glint-settings";
import { EYE_RASTER_REGION, initialRecipe } from "./fixtures/eye-region";
import { collectionServiceOver } from "./fixtures/profile-studio";
import { preparePackageCollection } from "./fixtures/eye-exporter";
import { eyeCheck, eyeBuild } from "./fixtures/package-results";
import type { Recipe } from "../src/engines/layered-makeup/recipe";

const sha = (value: string | Uint8Array | Uint8ClampedArray) => new Bun.CryptoHasher("sha256").update(value).digest("hex");
// Preserve every portable string byte as lines, avoiding formatter-only trailing whitespace in frozen snapshots.
const snapshotLines = (value: any): any => typeof value === "string" && value.includes("\n") ? value.split("\n")
  : Array.isArray(value) ? value.map(snapshotLines) : value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, snapshotLines(item)])) : value;
test("1a6cdc80 portable recipe bytes, names, outcomes and invalid-file refusals", async () => {
  let recipe = initialRecipe(), next: StudioPickedFile | undefined;
  const downloads: { name: string; blob: Blob }[] = [], imported: unknown[] = [];
  const files = new StudioFileOperations({ pick: async () => next, download: (blob, name) => downloads.push({ blob, name }),
    bakeMask: async () => new Blob() }, {
    featureFiles: makeupFileOperations({ recipe: () => recipe, selectedLayer: () => recipe.layers[0],
      importRecipe: (value, name, into) => { imported.push({ value, name, into }); } }),
    hasSavedV: () => false, savedV: () => undefined, loadSavedV: () => ({}), savedVReady: () => false,
    executeCollection: async () => { throw Error("unused"); }, recoverCollection: () => {},
  });
  const result: unknown[] = [];
  try {
    for (const variant of ["plain", "direct", "game", "mottle"]) {
      recipe = initialRecipe();
      if (variant === "direct") { recipe.layers[0].finish = "glitter"; recipe.layers[0].flakes = defaultDirectGlintFlakes(); }
      if (variant === "game") { recipe.layers[0].finish = "glossy"; recipe.layers[0].optics = { model: "game-matched-1" }; }
      if (variant === "mottle") recipe.layers[0].effects = { mottle: mottlePreset("powder", 103) };
      const outcome = await files.execute({ kind: "recipe.export" }), saved = downloads.at(-1)!;
      const text = await saved.blob.text();
      next = { name: "Round trip.json", size: text.length, text: async () => text, bytes: async () => new TextEncoder().encode(text) };
      const opened = await files.execute({ kind: "recipe.import", collection: "captured-collection" });
      expect(imported.at(-1)).toEqual({ value: recipe, name: "Round trip", into: "captured-collection" });
      result.push({ variant, name: saved.name, type: saved.blob.type, bytes: saved.blob.size, sha256: sha(text), outcome, opened });
    }
    for (const value of ["{", "{}", JSON.stringify(initialRecipe()), '{"schema":"xfs/recipe-99"}']) {
      next = { name: "Invalid.json", size: value.length, text: async () => value, bytes: async () => new TextEncoder().encode(value) };
      result.push(await files.execute({ kind: "recipe.import", collection: "captured-collection" }));
    }
    expect(result).toMatchSnapshot();
  } finally { files.dispose(); }
});

test("1a6cdc80 collection file, compiler plan, Check/Build payloads and partial-export reports", async () => {
  const recipe = initialRecipe(); recipe.layers[1].finish = "glitter";
  const source = { schema: "xfas/collection-1", id: "00000000-0000-4000-8000-000000000011", name: "File parity", presets: [
    { id: "00000000-0000-4000-8000-000000000012", name: "Mixed", revision: 1, recipe },
  ] };
  const sent: unknown[] = [];
  const f = await collectionServiceOver(source, { package: async (action, input) => {
    sent.push({ action, input }); const checked = eyeCheck(source, { presets: [] });
    return action === "check" ? checked : eyeBuild(checked);
  } });
  try {
    const results = [];
    for (const request of [{ kind: "exportCollection" }, { kind: "exportPlan" },
      { kind: "package", action: "check" }, { kind: "package", action: "build" }] as const) {
      const result = await f.svc.execute(request);
      expect(result.ok).toBe(true);
      const progress = f.svc.summary().progress;
      results.push({ result, message: progress?.message });
    }
    const prepared = preparePackageCollection(source);
    expect(snapshotLines({ results, sent, plan: prepared.plan, omissions: prepared.omissions,
      packagedSha256: sha(JSON.stringify(prepared.packaged)) })).toMatchSnapshot();
  } finally { f.svc.dispose(); f.outbox.stop(); f.library.close(); }
});

/** Run the browser baker through the actual worker entry; only canvas/PNG encoding is a CPU test double. */
test("registered 2048 mask bake sends its region and equals the real raster output (baseline bug)", async () => {
  const originalWorker = globalThis.Worker, originalPixels = globalThis.ImageData;
  const responses: RasterResponse[] = [], workers: WorkerDouble[] = [];
  class WorkerDouble {
    private actual: Worker;
    onmessage?: (event: MessageEvent<RasterResponse>) => void;
    onerror?: () => void;
    terminated = false;
    constructor(url: string, options: WorkerOptions) {
      workers.push(this); this.actual = new originalWorker(url, options);
      this.actual.onmessage = event => { responses.push(event.data); this.onmessage?.(event); };
      this.actual.onerror = () => this.onerror?.();
    }
    terminate() { this.terminated = true; this.actual.terminate(); }
    postMessage(request: RasterRequest) {
      this.actual.postMessage(request);
    }
  }
  globalThis.Worker = WorkerDouble as never;
  globalThis.ImageData = class { constructor(readonly data: Uint8ClampedArray) { if (!data) throw Error("No mask pixels."); } } as never;
  const canvases: { width: number; height: number; pixels?: Uint8ClampedArray }[] = [];
  const doc = { createElement: () => {
    const canvas = { width: 0, height: 0, pixels: undefined as Uint8ClampedArray | undefined,
      getContext: () => ({ putImageData: (value: ImageData) => { canvas.pixels = value.data; } }),
      toBlob: (done: (blob: Blob) => void) => done(new Blob([new Uint8Array(canvas.pixels!)], { type: "image/png" })) };
    canvases.push(canvas); return canvas;
  } } as unknown as Document;
  try {
    const device = createBrowserFileDevice({ document: doc, pickers: {} as never, maskBake: registeredMaskBake(STUDIO_REGISTRY, { live: "eye-makeup" }),
      workerUrl: new URL("./fixtures/mask-worker.ts", import.meta.url).href });
    for (const variant of ["plain", "directional", "mottle"]) {
      const layer = structuredClone(initialRecipe().layers[0]); layer.enabled = false;
      if (variant === "directional") {
        layer.points.forEach((point, i) => { point.weight = i / layer.points.length; point.feather = .001 + i * .008; });
        layer.softness = { mode: "boundary", blend: .0000078125 };
      }
      if (variant === "mottle") layer.effects = { mottle: mottlePreset("powder", 103) };
      const blob = await device.bakeMask!(layer, AbortSignal.timeout(20_000));
      expect(responses.at(-1)).not.toHaveProperty("error");
      let expected: RasterResponse | undefined;
      await createRasterProcessor(value => { expected = value; }, async () => {}, () => 0)
        .start({ i: 0, version: 0, layer: { ...layer, enabled: true }, size: 2048, region: EYE_RASTER_REGION });
      expect(expected && "data" in expected).toBe(true);
      if (expected && "data" in expected) {
        expect(expected.data.some((value, i) => i % 4 === 3 && value > 0)).toBe(true);
        expect(sha(new Uint8Array(await blob.arrayBuffer()))).toBe(sha(expected.data));
        console.log(`corrected ${variant} mask: ${sha(expected.data)}`);
      }
    }
    expect(responses).toHaveLength(3);
    expect(canvases[0]).toMatchObject({ width: 2048, height: 2048 }); expect(workers.every(worker => worker.terminated)).toBe(true);
  } finally { for (const worker of workers) if (!worker.terminated) worker.terminate(); globalThis.Worker = originalWorker; globalThis.ImageData = originalPixels; }
}, 30_000);
