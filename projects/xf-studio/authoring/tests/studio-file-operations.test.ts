import { expect, test } from "bun:test";
import { eyeCheck } from "./fixtures/package-results";
import { CollectionServiceError } from "../src/library/collection-service";
import { type Recipe } from "../src/engines/layered-makeup/recipe";
import { StudioFileOperations, type StudioPickedFile } from "../src/app/studio-file-operations";
import { BUILD_NEEDS_SETUP, BUILD_TOOLS_CHECKING_REASON } from "../src/app/alpha-availability";
import { initialRecipe } from "./fixtures/eye-region";
import { profileStudio } from "./fixtures/profile-studio";

const picked = (name: string, text: string, size = text.length): StudioPickedFile => ({
  name, size, text: async () => text, bytes: async () => new TextEncoder().encode(text),
});
async function fixture(buildReadiness?: () => "ready" | "needs-setup" | "checking" | "loading" | "damaged" | undefined) {
  const recipe = initialRecipe();
  const studio = await profileStudio({ name: "Library", looks: [{ name: "Eye", recipe }], check: input => {
    const value = input as { id: string; presets: { id: string }[] };
    return eyeCheck(value, { originalPresetCount: 2, omissions: [
      { kind: "layer", presetId: value.presets[0]!.id, presetName: "Eye", layerId: "sparkle", layerName: "Sparkle",
        finish: "glitter", reason: "Active finish has no supported game-export adapter." },
    ], presets: [{ id: value.presets[0]!.id, revision: 1, appearance: "xfs_test" }] });
  } });
  const service = studio.service, transport = studio.transport;
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
    recipe: () => studio.document.recipe, selectedLayer: () => layer,
    importRecipe: (value, name) => { imported = { recipe: value, name }; },
    hasSavedV: () => true,
    savedV: () => ({ gameVersion: 2000 } as any),
    loadSavedV: bytes => { loadedBytes = bytes; return { suggestedEyeShape: 3 }; },
    savedVReady: () => true,
    executeCollection: request => service.execute(request),
    recoverCollection: draft => service.dispatch({ kind: "collection.undoOpen", collection: studio.shown()!, ...(draft !== undefined ? { draft } : {}) }),
    buildReadiness,
  });
  files.attachCollection(service);
  // The library holds the collection before anything is asked (no acknowledgement arrives during a test's own steps).
  await studio.settle();
  /** An edit of the shown look's first layer's colour, as the person makes it. */
  const setColor = (color: string) => studio.app.dispatch({ kind: "layer.setColor", layerId: studio.document.recipe.layers[0]!.id, color });
  /** Another collection, imported (its working copy shown). */
  const importOther = async () => {
    const text = JSON.stringify({ schema: "xfs/collection-2", id: crypto.randomUUID(), name: "Other", presets: [
      { id: crypto.randomUUID(), name: "Eye", revision: 1, parts: studio.owner.look(studio.scene.look()!)!.parts }] });
    return service.execute({ kind: "import", text, bytes: text.length });
  };
  return { files, service, transport, recipe, studio, editor: () => ({ recipe: studio.document.recipe }), layer: () => layer,
    setFile: (file?: StudioPickedFile) => nextFile = file, downloads, saved: () => studio.library.collections.list().length,
    setBakeMask: (next: typeof bakeMask) => bakeMask = next, setColor, importOther,
    packageInput: () => studio.packageInput() as { presets: { recipe: Recipe }[] } | undefined, imported: () => imported, maskInput: () => maskInput,
    loadedBytes: () => loadedBytes };
}

test("recipe and mask workflows use typed file ports with the original names, limits and detached layer", async () => {
  const f = await fixture();
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
  for (const text of [JSON.stringify(f.editor().recipe), JSON.stringify({ schema: "xfas/collection-1", id: crypto.randomUUID(), name: "Library", presets: [] })]) {
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
  const f = await fixture();
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
  const f = await fixture();
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
  const f = await fixture(); await f.service.execute({ kind: "initialize" });
  f.setColor("#123456");
  const result = await f.files.executeCollection({ kind: "package", action: "check" });
  expect(result.ok && result.result.kind).toBe("packageCheck");
  expect(f.saved()).toBe(0);
  expect(f.packageInput()?.presets[0].recipe.layers[0].color).toBe("#123456");
  const state = f.files.snapshot();
  expect(state.progress).toMatchObject({ phase: "success", code: "packageCheck" });
  expect(state.package).toMatchObject({ kind: "packageCheck", result: { originalPresetCount: 2,
    products: [{ features: [{ omissions: [{ kind: "layer", finish: "glitter" }] }] }] }, freshness: "current" });
  expect(state.last?.kind).toBe("package.check");
  (state.package as any).result.products[0].features[0].omissions[0].layerName = "outside";
  expect((f.files.snapshot().package as any).result.products[0].features[0].omissions[0].layerName).toBe("Sparkle");
});

test("package freshness follows exact authored content across edits, refresh and draft switches", async () => {
  const f = await fixture(); await f.service.execute({ kind: "initialize" });
  await f.files.executeCollection({ kind: "package", action: "check" });
  expect(f.files.snapshot().package?.freshness).toBe("current");
  await f.service.execute({ kind: "refresh" });
  expect(f.files.snapshot().package?.freshness).toBe("current");

  // An edit makes the result stale, and so does showing another collection (an edit later undone still counts, CORE-28).
  f.setColor("#123456");
  expect(f.files.snapshot().package?.freshness).toBe("stale");
  await f.files.executeCollection({ kind: "package", action: "check" });
  expect(f.files.snapshot().package?.freshness).toBe("current");
  expect(await f.importOther()).toMatchObject({ ok: true });
  expect(f.files.snapshot().package?.freshness).toBe("stale");
});

test("package state subscription exposes working then completed without retaining export JSON", async () => {
  const f = await fixture(); await f.service.execute({ kind: "initialize" });
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
  f.setColor("#123456");
  // The Check reads the collection's snapshot first (its changes reach the library), then asks the host.
  while (!release) await Bun.sleep(1);
  release(); await pending;
  expect(f.files.snapshot()).toMatchObject({ collectionBusy: false, progress: { phase: "success" },
    last: { kind: "package.check", ok: true, code: "packageCheck" },
    package: { freshness: "stale" } });
  expect(f.packageInput()?.presets[0].recipe.layers[0].color).not.toBe("#123456");
  expect(seen).toContain("true:working");
});

test("package errors retain stable code and clear an earlier success; recovery capability follows draft history", async () => {
  const f = await fixture(); await f.service.execute({ kind: "initialize" });
  await f.files.executeCollection({ kind: "package", action: "check" });
  f.transport.package = async () => { throw new CollectionServiceError("no_exportable_content", "Nothing eligible remains."); };
  expect(await f.files.executeCollection({ kind: "package", action: "build" })).toMatchObject({ ok: false,
    code: "no_exportable_content" });
  expect(f.files.snapshot().package).toBeUndefined();
  expect(f.files.snapshot().progress).toMatchObject({ phase: "error", code: "no_exportable_content" });
  expect(f.files.snapshot().recovery.available).toBe(false);
  const first = f.studio.shown();
  expect(await f.importOther()).toMatchObject({ ok: true });
  expect(f.files.snapshot().recovery.available).toBe(true);
  expect((await f.files.execute({ kind: "collection.recover" })).ok).toBe(true);
  expect(f.service.view().draft?.id).toBe(first);
});

test("collection import reads through file port and delegates strict parsing and recovery to collection service", async () => {
  const f = await fixture(); await f.service.execute({ kind: "initialize" });
  const imported = { schema: "xfs/collection-2", id: crypto.randomUUID(), name: "Imported", presets: [
    { id: crypto.randomUUID(), name: "Eye", revision: 1, parts: f.studio.owner.look(f.studio.scene.look()!)!.parts }] };
  f.setFile(picked("collection.json", JSON.stringify(imported)));
  expect(await f.files.execute({ kind: "collection.import" })).toMatchObject({ ok: true, code: "imported" });
  expect(f.service.view().draft?.id).toBe(imported.id);
  expect(f.files.snapshot().recovery.available).toBe(true);
  expect(f.saved()).toBe(0);
});

test("Build explains the missing developer setup everywhere Build is offered, while Check stays available", async () => {
  let readiness: "ready" | "needs-setup" | "checking" | "loading" | "damaged" = "needs-setup";
  const f = await fixture(() => readiness);
  expect(f.files.capability({ kind: "package.check" })).toEqual({ available: true });
  expect(f.files.capability({ kind: "package.build" })).toEqual({ available: false, reason: BUILD_NEEDS_SETUP });
  expect(await f.files.execute({ kind: "package.build" })).toMatchObject({ ok: false, message: BUILD_NEEDS_SETUP });
  expect(f.packageInput()).toBeUndefined();
  readiness = "loading";
  expect(f.files.capability({ kind: "package.build" }).reason).toBe("Your settings are still loading.");
  // The host's first tool check still running is not a missing setup.
  readiness = "checking";
  expect(f.files.capability({ kind: "package.build" })).toEqual({ available: false, reason: BUILD_TOOLS_CHECKING_REASON });
  readiness = "damaged";
  expect(f.files.capability({ kind: "package.build" }).reason).toContain("Restore the previous copy");
  readiness = "ready";
  expect(f.files.capability({ kind: "package.build" })).toEqual({ available: true });
  // Hosts without a Build setup keep deciding at request time.
  expect((await fixture()).files.capability({ kind: "package.build" })).toEqual({ available: true });
});
