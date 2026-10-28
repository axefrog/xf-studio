import { expect, test } from "bun:test";
import { bootstrapCollections } from "./fixtures/profile-studio";
import type { PresetCollection } from "../src/legacy/eye-makeup/export/preset-collection";
import { emptyPresentationStatus, PresentationStatusSource } from "../src/app/presentation-status";
import { PreviewQualityActions } from "../src/legacy/eye-makeup/preview/preview-quality-actions";
import { createTrustedAuthoringCore } from "./fixtures/makeup-core";
import { createTrustedStudioBootstrap } from "../src/app/trusted-studio-bootstrap";
import { UIPreferenceActions } from "../src/app/ui-preferences";
import { ViewportAttachment } from "../src/app/viewport-attachment";
import { STUDIO_COMPOSITION, STUDIO_DOCUMENTS } from "../src/compose/studio-registry";
import { finishCatalogue, freshWorkspace } from "./fixtures/eye-region";
import { preparePackageCollection } from "./fixtures/eye-exporter";

import { namedCore, type NamedTrustedCore } from "./fixtures/named-targets";
function mountFixture() {
  const workspace = freshWorkspace();
  workspace.history = Array.from({ length: 40 }, () => structuredClone(workspace.recipe));
  let core!: NamedTrustedCore;
  core = namedCore(createTrustedAuthoringCore(workspace, { resetStack: () => {}, selectedCollection: () => "draft" }, STUDIO_COMPOSITION));
  core.app.attach({ quality: new PreviewQualityActions(1024, { assess: () => ({ accepted: true }), replace: () => {} }) });
  const viewport = new ViewportAttachment<string>({ moveHost: () => {}, measure: () => ({ width: 1, height: 1 }),
    resize: () => {}, cancelInput: () => {}, inputCapture: () => false, headView: () => undefined,
    uvView: () => workspace.uvView, uvCommand: () => true, hitAt: () => undefined,
    queryContext: hit => core.app.contextQuery(hit) }, ["head", "uv"]);
  // The collection shown: "Fixture", saved as version 3, its first look the workspace's recipe and its second empty.
  const collections = bootstrapCollections(core.document, { name: "Fixture", saved: 3, looks: [{ name: "First", recipe: structuredClone(workspace.recipe) },
    { name: "Second", recipe: { ...structuredClone(workspace.recipe), layers: [] } }] });
  const source = { id: collections.id, presets: collections.looks };
  let status = emptyPresentationStatus(true);
  const statusSource = new PresentationStatusSource(() => status);
  const bootstrap = createTrustedStudioBootstrap({ core: { ...core, document: core.lookDocument, app: core.application }, targets: core.targets, focus: core.history.focus, viewport, collections: collections.deps,
    preferences: new UIPreferenceActions(workspace.uiPreferences), status: statusSource,
    previewReadiness: { readiness: () => ({ phase: "ready", size: 1024, pending: 0, waiting: false, estimatedBytes: 1, layers: [] }),
      subscribe: () => () => {} },
    onRecipeImported: () => {},
    savedAppearance: { has: () => false, read: () => undefined, load: () => { throw Error("none"); }, ready: () => false },
    fileDevice: { pick: async () => undefined, download: () => {}, bakeMask: async () => new Blob() } });
  const port = bootstrap.mount(value => value);
  return { port, core, source, setStatus: (next: typeof status) => { status = next; statusSource.changed(); } };
}

test("the editor read view is cached, detached and tracks geometry revisions", () => {
  const { port, core } = mountFixture();
  const layer = port.feature("eye-makeup").view().layer()!;
  expect(port.feature("eye-makeup").view().recipe()).toBe(port.feature("eye-makeup").view().recipe());
  (layer as { name: string }).name = "Tampered";
  expect(core.document.recipe.layers[core.document.active].name).not.toBe("Tampered");
  const before = port.feature("eye-makeup").view().revision();
  expect(port.authoring.dispatch({ kind: "layer.setOpacity", layerId: core.document.recipe.layers[0].id, opacity: .31 }).ok).toBe(true);
  expect(port.feature("eye-makeup").view().revision()).toBeGreaterThan(before);
  expect(port.feature("eye-makeup").view().recipe().layers[0].opacity).toBe(.31);
  expect(port.feature("eye-makeup").view().canUndo()).toBe(true);
  expect(port.feature("eye-makeup").view().active()).toBe(core.document.active);
  expect(port.feature("eye-makeup").view().selected()).toBe(core.document.selected);
});

test("library summary is a primitive projection with the live layer count and recovery facts", async () => {
  const { port, source } = mountFixture();
  const summary = port.library.summary();
  expect(summary.draft).toMatchObject({ id: source.id, name: "Fixture", revision: 3, selected: source.presets[0].id });
  expect(summary.draft!.presets.map(preset => preset.layers)).toEqual([4, 0]);
  expect(JSON.stringify(summary)).not.toContain("history");
  expect(port.authoring.dispatch({ kind: "layer.edit", command: { kind: "add" } }).ok).toBe(true);
  // The stored preset recipe is stale until the next stash; the summary reports the live editor.
  expect(port.library.summary().draft!.presets[0].layers).toBe(5);
  expect(port.authoring.dispatch({ kind: "preset.edit", command: { kind: "remove", id: source.presets[1].id } }).ok).toBe(true);
  expect(port.library.summary().draft!.removed).toEqual([{ id: source.presets[1].id, name: "Second", index: 1 }]);
  const text = JSON.stringify({ schema: "xfs/collection-2", id: crypto.randomUUID(), name: "Other", presets: [
    { id: crypto.randomUUID(), name: "First", revision: 1, parts: source.presets[0]!.parts }] });
  expect((await port.library.execute({ kind: "import", text, bytes: text.length })).ok).toBe(true);
  expect(port.library.summary().draft).toMatchObject({ name: "Other", previous: { id: source.id, name: "Fixture", revision: 3 } });
});

test("preview state excludes document and collection clones", () => {
  const { port } = mountFixture();
  const state = port.authoring.previewState();
  expect(Object.keys(state).sort()).toEqual(["character", "control", "eyeShapeOptions", "gesture", "lighting", "lightingSetups", "motion", "preview", "quality", "savedV"]);
  expect(state.quality).toMatchObject({ size: 1024, blocked: false });
  expect(state.savedV).toMatchObject({ loaded: false });
});

test("finish descriptors mirror the package filter instead of a UI copy of eligibility", () => {
  const catalogue = finishCatalogue(), base = freshWorkspace().recipe;
  expect(catalogue.map(item => item.id)).toEqual(["matte", "regular", "metallic", "shimmer", "glitter", "glossy", "iridescent"]);
  // Stored names that mean a finish come from the catalogue, so no view keeps the Satin alias (UI-54).
  expect(catalogue.filter(item => item.stored.length).map(item => [item.id, item.stored])).toEqual([["regular", ["satin"]]]);
  for (const finish of catalogue) {
    // Experimental finishes export in their game-matched model (a colour shift only as a whole-preset pigment).
    const optics = finish.exportAdapter !== "experimental" ? {} : { optics: finish.id === "iridescent"
      ? { model: "game-matched-1" as const, shift: { color: "#3fd4c2", strength: .6 } } : { model: "game-matched-1" as const } };
    const layer = { ...structuredClone(base.layers[0]), finish: finish.id, enabled: true, opacity: .8, ...optics };
    const matte = { ...structuredClone(base.layers[1]), finish: "matte" as const, enabled: true, opacity: .8 };
    const layers = finish.id === "iridescent" ? [layer] : [matte, layer];
    const collection: PresetCollection = { schema: "xfas/collection-1", id: crypto.randomUUID(), name: "Gate",
      presets: [{ id: crypto.randomUUID(), name: "Look", revision: 1, recipe: { schema: "xfs/recipe-11", ...base, layers } }] };
    const omitted = preparePackageCollection(collection).omissions.some(item => item.kind === "layer" && item.layerId === layer.id);
    expect(omitted).toBe(finish.exportAdapter === "none");
    expect(finish.preview === "preview-study").toBe(omitted);
    if (finish.exportAdapter === "experimental") {
      const earlier = structuredClone(collection); delete earlier.presets[0].recipe.layers.at(-1)!.optics;
      // The earlier browser-study model of the same finish does not export.
      if (finish.id === "iridescent") expect(() => preparePackageCollection(earlier)).toThrow();
      else expect(preparePackageCollection(earlier).omissions.some(item => item.kind === "layer" && item.layerId === layer.id)).toBe(true);
    }
  }
});

test("presentation status is read-only and published through the port subscription", () => {
  const { port, setStatus } = mountFixture();
  let calls = 0;
  const unsubscribe = port.subscribe(() => calls++);
  expect(port.status.snapshot()).toMatchObject({ verification: true, workspace: { kind: "idle" } });
  const next = emptyPresentationStatus(true);
  next.workspace = { kind: "saved", message: "Workspace saved in this browser" };
  setStatus(next);
  expect(calls).toBe(1);
  const read = port.status.snapshot();
  (read.workspace as { kind: string }).kind = "protected";
  expect(port.status.snapshot().workspace.kind).toBe("saved");
  expect(port.snapshot().status.workspace.kind).toBe("saved");
  unsubscribe();
});
