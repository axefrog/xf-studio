import { AuthoringControlEdits } from "../src/authoring-control-edits";
import { AuthoringDocument } from "../src/authoring-document";
import { AuthoringGestures } from "../src/authoring-gestures";
import { CollectionApplication } from "../src/collection-application";
import type { CollectionTransport } from "../src/collection-service";
import { collectionDraft } from "../src/collection-workspace";
import { eyeMakeupPort } from "../src/authoring-eye-makeup";
import { PreviewQualityActions } from "../src/preview-quality-actions";
import type { PresetCollection } from "../src/preset-collection";
import { RecipeActions } from "../src/recipe-actions";
import { StudioApplication } from "../src/studio-application";
import { StudioFileOperations } from "../src/studio-file-operations";
import { createStudioPresentation, type StudioPresentationPort } from "../src/studio-presentation";
import { UIPreferenceActions } from "../src/ui-preferences";
import { ViewportAttachment, type ViewportAttachmentPort } from "../src/viewport-attachment";
import { freshWorkspace } from "../src/workspace-state";

/**
 * A trusted presentation over real application services, without a browser. `hitAt` stands in
 * for the viewport pickers (default: the selected layer's first point).
 */
export function trustedFixture(options: { hitAt?: ViewportAttachmentPort<string>["hitAt"] } = {}): {
  shell: StudioPresentationPort<string>; packageInput: () => PresetCollection | undefined;
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
  const app = new StudioApplication({ document, eyeMakeup: eyeMakeupPort(document, recipe), gestures, controls, undo, quality });
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
    hitAt: options.hitAt ?? (() => ({ hit: { kind: "point", layerId: document.recipe.layers[document.active].id,
      index: 0 }, affordance: "point" })),
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
