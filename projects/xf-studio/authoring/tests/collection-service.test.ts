import { expect, test } from "bun:test";
import { eyeCheck } from "./fixtures/package-results";
import { BUILD_PROGRESS_INTERVAL_MS, CollectionServiceError, uniqueCollectionName } from "../src/library/collection-service";
import type { PackageBuildProgress } from "../src/platform/api";
import { profileStudio } from "./fixtures/profile-studio";

async function fixture() {
  const studio = await profileStudio({ looks: [{ name: "Eye" }] });
  await studio.collection.initialize();
  return studio;
}
const layer = (studio: Awaited<ReturnType<typeof fixture>>) => studio.document.recipe.layers[0]!;

test("a partial Check says so in one status line; the result card names what is left out (C-14)", async () => {
  const f = await fixture();
  f.transport.package = async (_action, input) => { const value = input as { id: string; presets: { id: string }[] }; return eyeCheck(value, { originalPresetCount: 2,
    presets: [{ id: value.presets[0]!.id, revision: 1, appearance: "xfs_test" }],
    omissions: [
      { kind: "layer", presetId: value.presets[0]!.id, presetName: "Eye", layerId: "sparkle", layerName: "Sparkle",
        finish: "glitter", reason: "Active finish has no supported game-export adapter." },
      { kind: "preset", presetId: "other", presetName: "Glitter only", reason: "None of its shown layers can be built into your mod yet." },
    ] }); };
  expect((await f.collection.execute({ kind: "package", action: "check" })).ok).toBe(true);
  const line = f.collection.view().progress!.message;
  expect(line).toBe("Check: 1 of 2 presets can become mod files, some left out.");
  expect(line.length).toBeLessThanOrEqual(70);
});

test("a Build's status line names the mod and never a folder path (UI-151)", async () => {
  const { packageBuildLine } = await import("../src/legacy/eye-makeup/export/package-filter");
  const product = { modName: "XF Eye Artistry", package: "C:\Data\package-candidates\c1", manifest: "C:\Data\package-candidates\c1\manifest.json",
    features: [{ presets: [{ id: "a" }, { id: "b" }], warnings: [] }] };
  const line = packageBuildLine({ originalPresetCount: 3, omissions: [], products: [product] } as never);
  expect(line).toBe("Built XF Eye Artistry for 2 of 3 presets. Not in your game yet.");
  expect(line).not.toContain("package-candidates");
  expect(line.length).toBeLessThanOrEqual(70);
  expect(packageBuildLine({ originalPresetCount: 2, omissions: [], products: [product, { ...product, modName: "XF Two" }] } as never))
    .toBe("Built 2 mods for 2 of 2 presets. Not in your game yet.");
});

test("edits made while a Check is in flight stay in the look; the request is busy meanwhile and refuses another", async () => {
  const f = await fixture();
  let release!: () => void;
  const answer = f.transport.package;
  f.transport.package = (action, input) => new Promise(resolve => { release = () => resolve(answer(action, input)); });
  const pending = f.collection.execute({ kind: "package", action: "check" });
  await Bun.sleep(20);
  expect(f.collection.view().busy).toBe(true);
  expect(f.app.requestCapability({ kind: "save" }).available).toBe(false);
  f.app.dispatch({ kind: "layer.setColor", layerId: layer(f).id, color: "#abcdef" });
  release();
  expect((await pending).ok).toBe(true);
  expect(layer(f).color).toBe("#abcdef");
  expect(await f.settle()).toBe(true);
  expect(JSON.stringify(f.owner.look(f.scene.look()!)!.parts)).toContain("#abcdef");
});

test("no-exportable-content errors retain a stable code and an actionable message", async () => {
  const f = await fixture();
  f.transport.package = async () => { throw new CollectionServiceError("no_exportable_content",
    "No mod files can be made: every preset has no active Matte, Satin or Metallic layer. Your collection is unchanged."); };
  const outcome = await f.collection.execute({ kind: "package", action: "check" });
  expect(outcome).toMatchObject({ ok: false, code: "no_exportable_content" });
  expect(f.collection.view().progress?.message).toContain("Your collection is unchanged");
  expect(f.collection.view().busy).toBe(false);
});

test("opening the Studio reads the saved list without replacing the shown collection", async () => {
  const f = await profileStudio({ looks: [{ name: "Eye" }] });
  const result = await f.collection.initialize();
  expect(result.ok).toBe(true);
  expect(f.collection.summary().draft).toMatchObject({ name: "Current", presets: [{ name: "Eye" }] });
  expect(f.collection.view().progress?.message).toContain("your unsaved edits are kept");
});

test("a library with no collection gets a starter collection of one look, shown at once", async () => {
  const f = await profileStudio({ looks: [] });
  expect(f.collection.summary().draft).toBeUndefined();
  expect((await f.collection.initialize()).ok).toBe(true);
  expect(f.collection.summary().draft).toMatchObject({ name: "My collection", presets: [{ name: "Preset 1", layers: 1 }] });
  expect(f.document.recipe.layers).toHaveLength(1);
});

test("a Save version that fails reports its reason and keeps the working copy as it is", async () => {
  const f = await fixture();
  f.app.dispatch({ kind: "layer.setColor", layerId: layer(f).id, color: "#13579b" });
  (f.owner as unknown as { deps: { versions: { save(): Promise<never> } } }).deps.versions = { save: async () => { throw Error("The version couldn't be saved right now. Your working copy is safe."); } };
  const outcome = await f.collection.execute({ kind: "save" });
  expect(outcome).toMatchObject({ ok: false, message: "The version couldn't be saved right now. Your working copy is safe." });
  expect(f.collection.summary().draft!.revision).toBeUndefined();
  expect(JSON.stringify(f.owner.look(f.scene.look()!)!.parts)).toContain("#13579b");
});

test("PIPE-131: while a Build runs, its progress line and bar follow the host's stage, and stop with its answer", async () => {
  const f = await fixture();
  let current: PackageBuildProgress | null = { stage: "convert", step: 3, steps: 5, looks: 2 }, finish!: (error: Error) => void;
  f.transport.packageProgress = async () => current;
  f.transport.package = () => new Promise((_resolve, reject) => { finish = reject; });
  const running = f.collection.execute({ kind: "package", action: "build" });
  await Bun.sleep(60);
  expect(f.collection.view().progress).toMatchObject({ phase: "working", code: "package", message: "Step 3 of 5: Converting 2 looks…", fraction: .5 });
  current = { stage: "verify", step: 5, steps: 5, looks: 2 };
  await Bun.sleep(BUILD_PROGRESS_INTERVAL_MS + 100);
  expect(f.collection.view().progress).toMatchObject({ message: "Step 5 of 5: Checking the mod files…", fraction: .9 });
  finish(new CollectionServiceError("package_build_failed", "Package Build failed. Your draft is unchanged; nothing was installed."));
  await running;
  await Bun.sleep(BUILD_PROGRESS_INTERVAL_MS + 50);
  // Its answer is the last word: no later stage overwrites it.
  expect(f.collection.view().progress).toMatchObject({ phase: "error", code: "package_build_failed" });
});

test("a copy's name is one no other collection has (CORE-124)", () => {
  expect(uniqueCollectionName("Looks", ["Other"])).toBe("Looks");
  expect(uniqueCollectionName("Looks", ["looks"])).toBe("Looks 2");
  expect(uniqueCollectionName("Looks 2", ["Looks 2", "Looks 3"])).toBe("Looks 4");
});
