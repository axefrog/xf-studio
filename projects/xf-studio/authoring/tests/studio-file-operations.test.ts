import { expect, test } from "bun:test";
import { CollectionService, CollectionServiceError, type CollectionTransport } from "../src/collection-service";
import { collectionDraft, emptyMemory } from "../src/collection-workspace";
import { initialRecipe, type Recipe } from "../src/engines/layered-makeup/recipe";
import type { EditorSnapshot } from "../src/collection-session";
import type { PresetCollection } from "../src/preset-collection";
import { looks } from "./fixtures/looks";
import { StudioFileOperations, type StudioPickedFile } from "../src/studio-file-operations";
import { BUILD_NEEDS_SETUP } from "../src/alpha-availability";
import { recipeFile } from "../src/recipe-schema";
import { STUDIO_DOCUMENTS } from "../src/compose/studio-registry";

const picked = (name: string, text: string, size = text.length): StudioPickedFile => ({
  name, size, text: async () => text, bytes: async () => new TextEncoder().encode(text),
});
function fixture(buildReadiness?: () => "ready" | "needs-setup" | "loading" | "damaged" | undefined) {
  const recipe = initialRecipe(), collection: PresetCollection = { schema: "xfas/collection-1",
    id: crypto.randomUUID(), name: "Library", presets: [{ id: crypto.randomUUID(), name: "Eye", revision: 1, recipe: recipeFile(recipe)! }] };
  let editor: EditorSnapshot = { recipe: structuredClone(recipe), ...emptyMemory() };
  let saved = 0, packageInput: PresetCollection | undefined;
  const transport: CollectionTransport = {
    list: async () => [{ id: collection.id, name: collection.name, count: 1, revision: 1, updatedAt: "now" }],
    get: async () => ({ collection: looks(collection), revision: 1, updatedAt: "now" }),
    save: async value => { saved++; return { collection: structuredClone(value), revision: 2, updatedAt: "now" }; },
    package: async (_action, value) => { packageInput = value; return { ready: true, collectionId: value.id,
      namespace: "xfs_test", modName: "XF Eye Artistry", selectorLabel: "XF Eye Artistry", originalPresetCount: 2, omissions: [
        { kind: "layer", presetId: value.presets[0].id, presetName: "Eye", layerId: "sparkle", layerName: "Sparkle",
          finish: "glitter", reason: "Active finish has no supported game-export adapter." },
      ], packagedCollectionSha256: "hash", presets: [{ id: value.presets[0].id, revision: 1, appearance: "xfs_test" }] }; },
  };
  const service = new CollectionService(STUDIO_DOCUMENTS, collectionDraft(collection, STUDIO_DOCUMENTS, 1), { selected: "", name: "" },
    () => editor, value => editor = value, transport);
  let nextFile: StudioPickedFile | undefined, layer = structuredClone(recipe.layers[0]);
  const downloads: { name: string; type: string; blob: Blob }[] = [];
  let maskInput: typeof layer | undefined, imported: { recipe: Recipe; name: string } | undefined;
  let loadedBytes: Uint8Array | undefined;
  let bakeMask = async (_value: typeof layer) => new Blob(["png"], { type: "image/png" });
  const files = new StudioFileOperations({
    pick: async () => { const file = nextFile; nextFile = undefined; return file; },
    download: (blob, name) => { downloads.push({ name, type: blob.type, blob }); },
    bakeMask: async value => { maskInput = value; return bakeMask(value); },
  }, {
    recipe: () => editor.recipe, selectedLayer: () => layer,
    importRecipe: (value, name) => { imported = { recipe: value, name }; },
    hasSavedV: () => true,
    savedV: () => ({ gameVersion: 2000 } as any),
    loadSavedV: bytes => { loadedBytes = bytes; return { suggestedEyeShape: 3 }; },
    savedVReady: () => true,
    executeCollection: request => service.execute(request),
    recoverCollection: () => service.dispatch({ kind: "collection.undoOpen" }),
    buildReadiness,
  });
  files.attachCollection(service);
  return { files, service, transport, recipe, collection, editor: () => editor, layer: () => layer,
    setFile: (file?: StudioPickedFile) => nextFile = file, downloads, saved: () => saved,
    setBakeMask: (next: typeof bakeMask) => bakeMask = next,
    packageInput: () => packageInput, imported: () => imported, maskInput: () => maskInput,
    loadedBytes: () => loadedBytes };
}

test("recipe and mask workflows use typed file ports with the original names, limits and detached layer", async () => {
  const f = fixture();
  expect((await f.files.execute({ kind: "recipe.export" })).ok).toBe(true);
  expect(f.downloads[0]?.name).toBe("xfs.recipe.json");
  expect(f.downloads[0]?.type).toStartWith("application/json");
  // Export writes the oldest recipe schema that holds the recipe, and import reads it back unchanged.
  const exported = JSON.parse(await f.downloads[0]!.blob.text());
  expect(exported).toEqual({ schema: "xfs/recipe-7", ...f.editor().recipe });
  f.setFile(picked("wing.json", JSON.stringify(exported)));
  expect((await f.files.execute({ kind: "recipe.import" })).ok).toBe(true);
  expect(f.imported()?.name).toBe("wing");
  expect(f.imported()?.recipe).toEqual(f.editor().recipe);
  // Only recipe files import: a bare in-memory recipe or a collection is refused as before.
  for (const text of [JSON.stringify(f.editor().recipe), JSON.stringify(f.collection)]) {
    f.setFile(picked("other.json", text));
    expect(await f.files.execute({ kind: "recipe.import" })).toMatchObject({ ok: false });
  }
  f.setFile(picked("wing.json", JSON.stringify(exported)));
  expect((await f.files.execute({ kind: "recipe.import" })).ok).toBe(true);
  f.setFile(picked("large.json", "{}", 1_000_001));
  expect(await f.files.execute({ kind: "recipe.import" })).toMatchObject({ ok: false, code: "too_large" });
  expect(f.imported()?.name).toBe("wing");
  expect((await f.files.execute({ kind: "mask.export" })).ok).toBe(true);
  expect(f.downloads.at(-1)).toMatchObject({ name: `xfs-${f.layer().id}-alpha.png`, type: "image/png" });
  expect(f.maskInput()).not.toBe(f.layer());
  expect(f.files.snapshot().busy).toBeUndefined();
});

test("refused file actions cannot release or replace an in-flight mask export", async () => {
  const f = fixture();
  let release!: (blob: Blob) => void;
  f.setBakeMask(() => new Promise<Blob>(resolve => { release = resolve; }));
  const snapshots: { busy?: string; last?: string }[] = [];
  f.files.subscribe(() => {
    const state = f.files.snapshot();
    snapshots.push({ busy: state.busy, last: state.last?.code });
  });

  const pending = f.files.execute({ kind: "mask.export" });
  expect(f.files.snapshot().busy).toBe("mask.export");
  expect(f.files.capability({ kind: "mask.export" })).toMatchObject({ available: false });
  expect(await f.files.execute({ kind: "recipe.export" })).toMatchObject({ ok: false, code: "busy",
    message: "Another file operation is in progress." });
  expect(f.files.snapshot()).toMatchObject({ busy: "mask.export" });
  expect(f.files.snapshot().last).toBeUndefined();
  expect(snapshots).toEqual([{ busy: "mask.export", last: undefined }]);
  expect(await f.files.execute({ kind: "mask.export" })).toMatchObject({ ok: false, code: "busy" });
  expect(f.downloads).toHaveLength(0);

  release(new Blob(["png"], { type: "image/png" }));
  expect(await pending).toMatchObject({ ok: true, code: "exported" });
  expect(f.files.snapshot()).toMatchObject({ last: { kind: "mask.export", ok: true, code: "exported" } });
  expect(f.files.snapshot().busy).toBeUndefined();
  expect(snapshots).toEqual([{ busy: "mask.export", last: undefined }, { busy: undefined, last: "exported" }]);
  expect(f.downloads).toHaveLength(1);

  // An unavailable action reports a reason without replacing the completed operation's status.
  const denied = await f.files.execute({ kind: "collection.recover" });
  expect(denied).toMatchObject({ ok: false, code: "unavailable" });
  expect(denied.message).toBeTruthy();
  expect(f.files.snapshot().last).toMatchObject({ kind: "mask.export", code: "exported" });
  expect(snapshots).toHaveLength(2);
  expect((await f.files.execute({ kind: "recipe.export" })).ok).toBe(true);

  f.setBakeMask(async () => { throw Error("Raster worker failed."); });
  expect(await f.files.execute({ kind: "mask.export" })).toMatchObject({ ok: false, code: "file_failed",
    message: "Raster worker failed." });
  expect(f.files.snapshot()).toMatchObject({ last: { kind: "mask.export", ok: false, code: "file_failed" } });
  expect(f.files.snapshot().busy).toBeUndefined();
  expect(await f.files.execute({ kind: "recipe.import" })).toMatchObject({ ok: false, code: "cancelled" });
  expect(f.files.snapshot()).toMatchObject({ last: { kind: "recipe.import", ok: false, code: "cancelled" } });
});

test("saved-V acquisition returns typed result and cancellation never applies bytes", async () => {
  const f = fixture();
  f.setFile(picked("V.dat", "bytes"));
  expect(await f.files.execute({ kind: "savedV.import" })).toMatchObject({ ok: true, code: "loaded",
    savedAppearance: { suggestedEyeShape: 3 } });
  expect(new TextDecoder().decode(f.loadedBytes())).toBe("bytes");
  expect(await f.files.execute({ kind: "savedV.import" })).toMatchObject({ ok: false, code: "cancelled" });
  expect(f.files.snapshot().busy).toBeUndefined();
  expect((await f.files.execute({ kind: "savedV.export" })).ok).toBe(true);
  expect(f.downloads.at(-1)?.name).toBe("v-appearance.json");
});

test("package check exposes progress, partial result and unsaved snapshot without SQLite write", async () => {
  const f = fixture(); await f.service.execute({ kind: "initialize" });
  f.editor().recipe.layers[0].color = "#123456";
  const result = await f.files.executeCollection({ kind: "package", action: "check" });
  expect(result.ok && result.result.kind).toBe("packageCheck");
  expect(f.saved()).toBe(0);
  expect(f.packageInput()?.presets[0].recipe.layers[0].color).toBe("#123456");
  const state = f.files.snapshot();
  expect(state.progress).toMatchObject({ phase: "success", code: "packageCheck" });
  expect(state.package).toMatchObject({ kind: "packageCheck", result: { originalPresetCount: 2,
    omissions: [{ kind: "layer", finish: "glitter" }] }, freshness: "current" });
  expect(state.last?.kind).toBe("package.check");
  (state.package as any).result.omissions[0].layerName = "outside";
  expect((f.files.snapshot().package as any).result.omissions[0].layerName).toBe("Sparkle");
});

test("package freshness follows exact authored content across edits, refresh and draft switches", async () => {
  const f = fixture(); await f.service.execute({ kind: "initialize" });
  await f.files.executeCollection({ kind: "package", action: "check" });
  expect(f.files.snapshot().package?.freshness).toBe("current");
  await f.service.execute({ kind: "refresh" });
  expect(f.files.snapshot().package?.freshness).toBe("current");

  const original = f.editor().recipe.layers[0].color;
  f.editor().recipe.layers[0].color = "#123456";
  expect(f.files.snapshot().package?.freshness).toBe("stale");
  f.editor().recipe.layers[0].color = original;
  expect(f.files.snapshot().package?.freshness).toBe("current");

  const other = structuredClone(f.collection); other.id = crypto.randomUUID(); other.name = "Other";
  f.service.dispatch({ kind: "collection.open", collection: other, revision: 1 });
  expect(f.files.snapshot().package?.freshness).toBe("stale");
  f.service.dispatch({ kind: "collection.undoOpen" });
  expect(f.files.snapshot().package?.freshness).toBe("current");
});

test("package state subscription exposes working then completed without retaining export JSON", async () => {
  const f = fixture(); await f.service.execute({ kind: "initialize" });
  const original = f.transport.package;
  let release!: () => void;
  f.transport.package = async (action, collection) => {
    await new Promise<void>(resolve => { release = resolve; });
    return original(action, collection);
  };
  const seen: string[] = [];
  f.files.subscribe(() => seen.push(`${f.files.snapshot().collectionBusy}:${f.files.snapshot().progress?.phase}`));
  const pending = f.files.executeCollection({ kind: "package", action: "check" });
  expect(f.files.snapshot()).toMatchObject({ collectionBusy: true, progress: { phase: "working" } });
  f.editor().recipe.layers[0].color = "#123456";
  release(); await pending;
  expect(f.files.snapshot()).toMatchObject({ collectionBusy: false, progress: { phase: "success" },
    last: { kind: "package.check", ok: true, code: "packageCheck" },
    package: { freshness: "stale" } });
  expect(f.packageInput()?.presets[0].recipe.layers[0].color).not.toBe("#123456");
  expect(seen).toContain("true:working");
});

test("package errors retain stable code and clear an earlier success; recovery capability follows draft history", async () => {
  const f = fixture(); await f.service.execute({ kind: "initialize" });
  await f.files.executeCollection({ kind: "package", action: "check" });
  f.transport.package = async () => { throw new CollectionServiceError("no_exportable_content", "Nothing eligible remains."); };
  expect(await f.files.executeCollection({ kind: "package", action: "build" })).toMatchObject({ ok: false,
    code: "no_exportable_content" });
  expect(f.files.snapshot().package).toBeUndefined();
  expect(f.files.snapshot().progress).toMatchObject({ phase: "error", code: "no_exportable_content" });
  expect(f.files.snapshot().recovery.available).toBe(false);
  const other = structuredClone(f.collection); other.id = crypto.randomUUID(); other.name = "Other";
  f.service.dispatch({ kind: "collection.open", collection: other, revision: 1 });
  expect(f.files.snapshot().recovery.available).toBe(true);
  expect((await f.files.execute({ kind: "collection.recover" })).ok).toBe(true);
  expect(f.service.view().draft?.collection.id).toBe(f.collection.id);
});

test("collection import reads through file port and delegates strict parsing and recovery to collection service", async () => {
  const f = fixture(); await f.service.execute({ kind: "initialize" });
  const imported = structuredClone(f.collection); imported.id = crypto.randomUUID();
  f.setFile(picked("collection.json", JSON.stringify(imported)));
  expect(await f.files.execute({ kind: "collection.import" })).toMatchObject({ ok: true, code: "imported" });
  expect(f.service.view().draft?.collection.id).toBe(imported.id);
  expect(f.files.snapshot().recovery.available).toBe(true);
  expect(f.saved()).toBe(0);
});

test("Build explains the missing developer setup everywhere Build is offered, while Check stays available", async () => {
  let readiness: "ready" | "needs-setup" | "loading" | "damaged" = "needs-setup";
  const f = fixture(() => readiness);
  expect(f.files.capability({ kind: "package.check" })).toEqual({ available: true });
  expect(f.files.capability({ kind: "package.build" })).toEqual({ available: false, reason: BUILD_NEEDS_SETUP });
  expect(await f.files.execute({ kind: "package.build" })).toMatchObject({ ok: false, message: BUILD_NEEDS_SETUP });
  expect(f.packageInput()).toBeUndefined();
  readiness = "loading";
  expect(f.files.capability({ kind: "package.build" }).reason).toBe("Build setup is still loading.");
  readiness = "damaged";
  expect(f.files.capability({ kind: "package.build" }).reason).toContain("Restore the previous copy");
  readiness = "ready";
  expect(f.files.capability({ kind: "package.build" })).toEqual({ available: true });
  // Hosts without a Build setup keep deciding at request time.
  expect(fixture().files.capability({ kind: "package.build" })).toEqual({ available: true });
});
