import { expect, test } from "bun:test";
import { registeredFeatureFiles, type FeatureFiles } from "../src/app/feature-files";
import { registeredMaskBake, createBrowserFileDevice } from "../src/app/browser/browser-file-device";
import { StudioFileOperations, type StudioFilePort } from "../src/app/studio-file-operations";
import { createAuthoringEditing } from "../src/app/trusted-authoring-core";
import { registeredCollectionExport, type CollectionExport } from "../src/library/collection-export";
import { STUDIO_OWNERS, STUDIO_REGISTRY } from "../src/compose/studio-registry";
import { Registry, type AnyOwner } from "../src/platform/core/registry";
import { PartRegistry } from "../src/platform/core/document";
import { createHistoryService } from "../src/platform/core/history-service";
import { collectionServiceOver } from "./fixtures/profile-studio";
import { editorCollection, FIXTURE_LOOK, SYNTHETIC_LAYERED, SYNTHETIC_ID } from "./fixtures/editor-composition";
import type { SyntheticPart } from "./fixtures/editor-composition";
import { PACKAGE_CHECK_2, PACKAGE_BUILD_2 } from "../src/platform/api";

const sources = { hasSavedV: () => true, savedV: () => undefined, loadSavedV: () => ({}), savedVReady: () => true,
  executeCollection: async () => { throw Error("No request expected."); }, recoverCollection() {} };
test("without makeup registration, files offer no makeup format, baker or export bridge and collections still open/save", async () => {
  const registry = new Registry<AnyOwner>(STUDIO_OWNERS.filter(owner => owner.id !== "eye-makeup"));
  const model = { parts: new PartRegistry([]), live: undefined };
  let reads = 0;
  const featureFiles = registeredFeatureFiles(registry, model.live, { get document(): never { reads++; throw Error("No makeup document"); },
    application: { dispatch() { throw Error("No makeup command"); } }, signal: new AbortController().signal, imported() {} });
  expect(featureFiles).toBeUndefined(); expect(reads).toBe(0);
  expect(registeredMaskBake(registry, model)).toBeUndefined(); expect(registeredCollectionExport(model)).toBeUndefined();
  const device = createBrowserFileDevice({ document: {} as Document, pickers: {} as never });
  expect(device.bakeMask).toBeUndefined();
  const files = new StudioFileOperations({ ...device, download() {}, pick: async () => undefined }, sources);
  const f = await collectionServiceOver(editorCollection(), { model }); files.attachCollection(f.svc);
  try {
    for (const kind of ["recipe.import", "recipe.export", "mask.export", "collection.plan", "package.check", "package.build"] as const)
      expect(files.capability(kind === "recipe.import" ? { kind, collection: FIXTURE_LOOK.collection } : { kind }).available).toBe(false);
    for (const kind of ["initialize", "save", "exportCollection", "refresh"] as const) expect((await f.svc.execute({ kind })).ok).toBe(true);
    expect(f.saved()?.presets[0]?.parts).toEqual({});
    const other = editorCollection(); other.id = "00000000-0000-4000-8000-000000000003"; other.presets[0]!.id = "00000000-0000-4000-8000-000000000004";
    const text = JSON.stringify(other);
    expect(await f.svc.execute({ kind: "import", text, bytes: text.length })).toMatchObject({ ok: true });
    expect(await f.svc.execute({ kind: "open", id: FIXTURE_LOOK.collection })).toMatchObject({ ok: true });
    expect(f.svc.draftIdentity()?.collectionId).toBe(FIXTURE_LOOK.collection);
    expect(files.capability({ kind: "savedV.import", character: "V" }).available).toBe(true);
  } finally { files.dispose(); f.svc.dispose(); f.outbox.stop(); f.library.close(); }
});

test("a synthetic registered file format and export bridge work over a neutral look without makeup projections", async () => {
  const received: unknown[] = [], downloads: { name: string; text: string }[] = [], life = new AbortController();
  const feature: typeof SYNTHETIC_LAYERED & { files: FeatureFiles; collectionExport: CollectionExport } = {
    ...SYNTHETIC_LAYERED, exports: { exporterId: "test/layers", brand: "Test Layers", selectorLabel: "Test", selector: "own" },
    files: { create(host) { return { portable: { name: "layers.json", invalidMessage: "Expected synthetic layers.", message: "Synthetic layers exported.",
      parse(value) { const file = value as { schema?: string; body?: unknown }; return file.schema === "test/layers" ? file.body : undefined; },
      serialize: () => ({ schema: "test/layers", body: host.document.features.read(SYNTHETIC_ID) }),
      load: (value, name, collection) => { host.signal.throwIfAborted(); received.push({ value, name, collection }); },
    } }; } },
    collectionExport: { unavailable: () => undefined, plan: collection => ({ schema: "test/build-plan", collection }),
      checkLine: () => "Synthetic Check", buildLine: () => "Synthetic Build", stageLine: () => "Synthetic stage" },
  };
  const registry = new Registry<AnyOwner>([feature as AnyOwner]), model = { parts: new PartRegistry([feature]), live: SYNTHETIC_ID };
  const editing = createAuthoringEditing({ features: { [SYNTHETIC_ID]: { part: SYNTHETIC_LAYERED.part.starter() } } },
    { history: createHistoryService(), signal: life.signal, look: FIXTURE_LOOK }, { registry, documents: model });
  let text = "";
  const device: StudioFilePort = { download: (blob, name) => { void blob.text().then(value => downloads.push({ name, text: value })); },
    pick: async () => ({ name: "Synthetic.json", size: text.length, text: async () => text, bytes: async () => new TextEncoder().encode(text) }) };
  const files = new StudioFileOperations(device, { ...sources, featureFiles: registeredFeatureFiles(registry, SYNTHETIC_ID,
    { document: editing.document, application: { dispatch() { throw Error("Not used"); } }, signal: life.signal, imported() {} }) });
  const sent: unknown[] = [];
  const f = await collectionServiceOver(editorCollection(true), { model, package: async (action, input) => {
    sent.push({ action, input });
    const common = { collectionId: FIXTURE_LOOK.collection, originalPresetCount: 1, products: [], omissions: [], collectionSha256: "synthetic" };
    return action === "check" ? { ...common, schema: PACKAGE_CHECK_2, ready: true }
      : { ...common, schema: PACKAGE_BUILD_2, installed: false, gameRenderingVerified: false };
  } }); files.attachCollection(f.svc);
  try {
    expect(await files.execute({ kind: "recipe.export" })).toMatchObject({ ok: true, message: "Synthetic layers exported." });
    text = downloads[0]!.text;
    expect(downloads[0]!.name).toBe("layers.json"); expect(JSON.parse(text).body).toEqual(SYNTHETIC_LAYERED.part.starter());
    expect(await files.execute({ kind: "recipe.import", collection: FIXTURE_LOOK.collection })).toMatchObject({ ok: true });
    expect(received).toEqual([{ value: SYNTHETIC_LAYERED.part.starter(), name: "Synthetic", collection: FIXTURE_LOOK.collection }]);
    expect(files.capability({ kind: "mask.export" }).available).toBe(false);
    for (const kind of ["save", "exportCollection", "exportPlan"] as const) {
      const result = await f.svc.execute({ kind }); expect(result.ok).toBe(true);
      if (result.ok && kind === "exportPlan" && result.result.kind === "export") expect(JSON.parse(result.result.json).schema).toBe("test/build-plan");
    }
    expect(f.svc.summary().products?.[0]?.modName).toBe("Test Layers");
    for (const action of ["check", "build"] as const) {
      expect((await f.svc.execute({ kind: "package", action })).ok).toBe(true);
      expect(f.svc.summary().progress?.message).toBe(action === "check" ? "Synthetic Check" : "Synthetic Build");
    }
    expect(sent).toHaveLength(2);
    expect((sent[0] as any).input).toEqual((sent[1] as any).input);
    expect((sent[0] as any).input.presets[0].parts).toHaveProperty(SYNTHETIC_ID);
    expect((sent[0] as any).input.presets[0].parts).not.toHaveProperty("eye-makeup");
    const part = editing.document.features.read(SYNTHETIC_ID) as SyntheticPart;
    expect(part.layers).toHaveLength(2); expect(editing.editors.has("eye-makeup")).toBe(false);
  } finally { files.dispose(); life.abort(); f.svc.dispose(); f.outbox.stop(); f.library.close(); }
});

test("the registered mask worker stops on abort, rejects error responses and cannot publish after cancellation", async () => {
  const original = globalThis.Worker, instances: { onmessage?: (event: any) => void; onerror?: () => void; terminated: number }[] = [];
  globalThis.Worker = class { onmessage?: (event: any) => void; onerror?: () => void; terminated = 0;
    constructor() { instances.push(this); } postMessage() {} terminate() { this.terminated++; }
  } as never;
  const baker = registeredMaskBake(STUDIO_REGISTRY, { live: "eye-makeup" })!.create({ document: {} as Document });
  try {
    const life = new AbortController(), pending = baker({}, life.signal), worker = instances[0]!;
    life.abort(Error("Released mask")); await expect(pending).rejects.toThrow("Released mask");
    expect(worker.terminated).toBe(1);
    worker.onmessage?.({ data: { data: new Uint8ClampedArray(2048 * 2048 * 4), size: 2048 } });
    expect(worker.terminated).toBe(1);
    const failed = baker({}); instances[1]!.onmessage?.({ data: { i: 0, version: 0, error: "bad raster" } });
    await expect(failed).rejects.toThrow("Mask export failed."); expect(instances[1]!.terminated).toBe(1);
    await expect(baker({}, AbortSignal.abort(Error("Already released")))).rejects.toThrow("Already released");
    expect(instances).toHaveLength(2);
  } finally { globalThis.Worker = original; }
});
