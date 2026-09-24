import { expect, test } from "bun:test";
import { AuthoringControlEdits } from "../src/authoring-control-edits";
import { AuthoringDocument } from "../src/authoring-document";
import { AuthoringGestures } from "../src/authoring-gestures";
import { CollectionApplication } from "../src/collection-application";
import type { CollectionTransport } from "../src/collection-service";
import { collectionDraft } from "../src/collection-workspace";
import { applyLayerAction } from "../src/editor-actions";
import { PreviewQualityActions } from "../src/preview-quality-actions";
import type { PresetCollection } from "../src/preset-collection";
import { RecipeActions } from "../src/recipe-actions";
import { StudioApplication } from "../src/studio-application";
import { StudioFileOperations } from "../src/studio-file-operations";
import { createStudioPresentation, type StudioPresentationPort } from "../src/studio-presentation";
import { UIPreferenceActions } from "../src/ui-preferences";
import { ViewportAttachment } from "../src/viewport-attachment";
import { freshWorkspace } from "../src/workspace-state";

function trustedFixture(): { shell: StudioPresentationPort<string>; packageInput: () => PresetCollection | undefined;
  downloads: string[]; locations: string[] } {
  const workspace = freshWorkspace(), document = new AuthoringDocument(workspace);
  const undo = () => { const prior = document.undoRecipe(); if (!prior) return false;
    document.replaceRecipe(prior, document.active); return true; };
  const recipe = new RecipeActions(() => ({ recipe: document.recipe, active: document.active,
    selected: document.selected, fieldSelection: document.fieldSelection }),
  (next, effect) => document.applyActionState(next, effect), document, {}, () => "fixture");
  const gestures = new AuthoringGestures(document, recipe, undo);
  const controls = new AuthoringControlEdits(document, action => recipe.dispatch(action), undo);
  const quality = new PreviewQualityActions(512, { assess: () => ({ accepted: true }), replace: () => {} });
  const app = new StudioApplication({ document, recipe, gestures, controls, undo, quality,
    layer: action => {
      const next = applyLayerAction(document.recipe, document.recipe.layers[document.active]?.id, action);
      document.checkpoint(); document.replaceRecipe(next.recipe, next.active);
    } });
  const source: PresetCollection = { schema: "xfas/collection-1", id: crypto.randomUUID(),
    name: "Current", presets: [{ id: crypto.randomUUID(), name: "Look", revision: 1,
      recipe: structuredClone(document.recipe) }] };
  let packageInput: PresetCollection | undefined;
  const transport: CollectionTransport = {
    list: async () => [], get: async () => { throw Error("No saved fixture collection."); },
    save: async () => { throw Error("No SQLite write in this fixture."); },
    package: async (_action, value) => { packageInput = value; return {
      ready: true, collectionId: value.id, namespace: "xfs_test", modName: "XF Eye Artistry", selectorLabel: "XF Eye Artistry", originalPresetCount: value.presets.length,
      omissions: [], packagedCollectionSha256: "fixture-hash",
      presets: value.presets.map(preset => ({ id: preset.id, revision: preset.revision,
        appearance: "xfs_fixture" })),
    }; },
  };
  const downloads: string[] = [];
  let library!: CollectionApplication;
  const files = new StudioFileOperations({ pick: async () => undefined,
    download: (_blob, name) => downloads.push(name), bakeMask: async () => new Blob() }, {
    recipe: () => document.recipe, selectedLayer: () => document.recipe.layers[document.active],
    importRecipe: (value, name) => library.importRecipe(value, name),
    hasSavedV: () => false, savedV: () => undefined, loadSavedV: () => ({}),
    savedVReady: () => false, executeCollection: request => app.execute(request),
    recoverCollection: () => library.recover(),
  });
  library = new CollectionApplication(collectionDraft(source, 1), workspace.library, document,
    () => {}, transport, app, files);
  const locations: string[] = [];
  let uvView = { mode: "both" as "both" | "single", side: "low" as "low" | "high",
    u: 0, v: 0, span: 1 };
  const viewport = new ViewportAttachment<string>({
    moveHost: (kind, slot) => locations.push(`${kind}:${slot}`),
    measure: () => ({ width: 500, height: 300 }), resize: () => {},
    cancelInput: () => {}, inputCapture: () => false, headView: () => undefined,
    uvView: () => uvView, uvCommand: command => {
      if (command === "single") uvView = { ...uvView, mode: "single" };
      if (command === "other") uvView = { ...uvView, side: "high" };
      if (command === "both") uvView = { ...uvView, mode: "both" };
      return true;
    },
    hitAt: () => ({ hit: { kind: "point", layerId: document.recipe.layers[document.active].id,
      index: 0 }, affordance: "point" }),
    queryContext: hit => app.contextQuery(hit),
  });
  viewport.setReady("uv"); viewport.setReady("head");
  const preferences = new UIPreferenceActions(workspace.uiPreferences);
  const previewReadiness = { readiness: () => ({ phase: "ready" as const, size: 1024 as const,
    pending: 0, waiting: false, estimatedBytes: 1024, layers: [] }), subscribe: (_listener: () => void) => () => {} };
  return { shell: createStudioPresentation({ authoring: app, library, files, viewport, preferences,
    previewReadiness }),
    packageInput: () => packageInput, downloads, locations };
}

test("replacement presentation can perform current cross-surface workflows without trusted objects", async () => {
  const { shell, packageInput, downloads, locations } = trustedFixture();
  expect(Object.keys(shell).sort()).toEqual(["authoring", "editor", "files", "installDetection", "library", "localSetup", "preferences",
    "previewReadiness", "snapshot", "status", "subscribe", "viewport"]);
  expect("document" in shell.authoring).toBe(false);
  let notifications = 0; const unsubscribe = shell.subscribe(() => notifications++);
  const initial = shell.snapshot(), firstLayer = initial.authoring.document.recipe.layers[0];
  expect(initial.previewReadiness).toMatchObject({ phase: "ready", size: 1024 });
  (initial.authoring.document.recipe.layers[0] as any).name = "Tampered";
  expect(shell.snapshot().authoring.document.recipe.layers[0].name).not.toBe("Tampered");

  expect(shell.authoring.capability({ kind: "layer.edit", command: { kind: "add" } }).available).toBe(true);
  expect(shell.authoring.dispatch({ kind: "layer.edit", command: { kind: "add" } }).ok).toBe(true);
  expect(shell.snapshot().authoring.document.recipe.layers).toHaveLength(5);
  expect(shell.authoring.dispatch({ kind: "recipe.undo" }).ok).toBe(true);
  expect(shell.snapshot().authoring.document.recipe.layers).toHaveLength(4);
  expect(shell.authoring.dispatch({ kind: "preset.edit", command: { kind: "copy",
    id: shell.library.view().draft!.selected! } }).ok).toBe(true);
  expect(shell.library.view().draft?.collection.presets).toHaveLength(2);
  expect(shell.authoring.dispatch({ kind: "preset.select", id: initial.library.draft!.selected! }).ok).toBe(true);

  expect(shell.viewport.uvCommandCapability("other").available).toBe(false);
  expect(shell.viewport.uvCommand("single")).toBe(true);
  expect(shell.viewport.uvCommand("other")).toBe(true);
  shell.viewport.rehost("uv", "floating");
  expect(locations).toContain("uv:floating");
  expect(shell.snapshot().viewport.uv.view).toMatchObject({ mode: "single", side: "high" });
  const query = shell.viewport.contextAt("uv", 20, 20)!;
  expect(query.options.some(option => option.id === "point.remove")).toBe(true);
  expect(shell.authoring.dispatch({ kind: "layer.setOpacity", layerId: firstLayer.id,
    opacity: .57 }).ok).toBe(true);
  expect(shell.authoring.dispatchContext(query.context, { kind: "point.remove",
    layerId: firstLayer.id, index: 0 })).toMatchObject({ ok: false, code: "missing_target" });

  expect(shell.authoring.dispatch({ kind: "quality.set", size: 1024 }).ok).toBe(true);
  expect(shell.snapshot().authoring.quality?.size).toBe(1024);
  expect((await shell.files.execute({ kind: "recipe.export" })).ok).toBe(true);
  expect(downloads).toContain("xfs.recipe.json");
  expect((await shell.files.execute({ kind: "package.check" })).ok).toBe(true);
  expect(shell.files.snapshot().package?.kind).toBe("packageCheck");
  expect(shell.snapshot().files.package?.freshness).toBe("current");
  expect(packageInput()?.id).toBe(shell.library.view().draft?.collection.id);
  expect(shell.authoring.dispatch({ kind: "layer.setOpacity", layerId: firstLayer.id,
    opacity: .42 }).ok).toBe(true);
  expect(shell.snapshot().files.package?.freshness).toBe("stale");
  expect(shell.preferences.capability({ kind: "theme.set", theme: "dark" }).available).toBe(true);
  shell.preferences.dispatch({ kind: "theme.set", theme: "dark" });
  expect(shell.snapshot().preferences.theme).toBe("dark");
  expect(notifications).toBeGreaterThan(0);
  unsubscribe();
});
