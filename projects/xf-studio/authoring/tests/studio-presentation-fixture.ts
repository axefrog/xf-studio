import type { PartPresetService } from "../src/library/part-presets";
import type { WorkspaceLease } from "../src/app/workspace/workspace-lease";
import { eyeCheck } from "./fixtures/package-results";
import { AuthoringControlEdits } from "../src/app/authoring/authoring-control-edits";
import { AuthoringDocument } from "./fixtures/makeup-document";
import { AuthoringGestures } from "../src/app/authoring/authoring-gestures";
import { CollectionApplication } from "../src/library/collection-application";
import type { CollectionTransport } from "../src/library/collection-service";
import { CollectionOwner } from "../src/library/collection-owner";
import { LookEditor } from "../src/library/look-editor";
import { LookSessions } from "../src/library/look-sessions";
import { DocumentOutbox } from "../src/platform/core/document-outbox";
import { openTestLibrary } from "./fixtures/library-file";
import { memoryOutboxStorage } from "./fixtures/platform-doubles";
import { libraryPort, libraryVersions, storedLook, testScene } from "./fixtures/profile-studio";
import { PreviewQualityActions } from "../src/legacy/eye-makeup/preview/preview-quality-actions";
import type { PresetCollection } from "../src/legacy/eye-makeup/export/preset-collection";
import { StudioApplication } from "../src/app/studio-application";
import { StudioFileOperations } from "../src/app/studio-file-operations";
import { createStudioPresentation, type StudioPresentationPort } from "../src/app/studio-presentation";
import { createViewServices } from "../src/app/view-actions";
import { STUDIO_MODULE_REGISTRATION } from "../src/compose/modules";
import { UIPreferenceActions } from "../src/app/ui-preferences";
import { ViewportAttachment, type ViewportAttachmentPort } from "../src/app/viewport-attachment";
import { recipeFile } from "../src/legacy/eye-makeup/recipe-schema";
import { registeredEditing } from "./gesture-test-adapter";
import { STUDIO_DOCUMENTS, STUDIO_REGISTRY } from "../src/compose/studio-registry";
import { RecipeActions } from "../src/legacy/eye-makeup/authoring-eye-makeup";
import { freshWorkspace } from "./fixtures/eye-region";
import { fixtureTargets } from "./fixtures/named-targets";
import { createHistoryService } from "../src/platform/core/history-service";
import { eyeMakeupPort } from "./fixtures/eye-region";

/**
 * A trusted presentation over real application services, without a browser. `hitAt` stands in
 * for the viewport pickers (default: the selected layer's first point).
 */
export function trustedFixture(options: { hitAt?: ViewportAttachmentPort<string>["hitAt"];
  presentation?: Pick<Parameters<typeof createStudioPresentation<string>>[0], "signal" | "panelInstance" | "scopeName" | "characterName" | "installDetection" | "localSetup" | "frameworkProducts" | "experiments">;
  /** The window's workspace lease (profiles design §2.3); without it the window is the only one. */
  presets?: PartPresetService;
  lease?: WorkspaceLease } = {}): {
  shell: StudioPresentationPort<string>; packageInput: () => PresetCollection | undefined;
  downloads: string[]; locations: string[]; outbox: DocumentOutbox } {
  const workspace = freshWorkspace(), history = createHistoryService(), document = new AuthoringDocument(workspace, undefined, { history });
  const recipe = new RecipeActions(() => ({ recipe: document.recipe, active: document.active,
    selected: document.selected, fieldSelection: document.fieldSelection }),
  (next, effect) => document.applyActionState(next, effect), document, {}, () => "fixture");
  const eyeMakeup = eyeMakeupPort(document, recipe), editing = registeredEditing(eyeMakeup);
  const gestures = new AuthoringGestures(document, editing.gestures);
  const controls = new AuthoringControlEdits(document, editing.controls);
  const quality = new PreviewQualityActions(512, { assess: () => ({ accepted: true }), replace: () => {} });
  const viewServices = createViewServices(workspace.preview, undefined, STUDIO_MODULE_REGISTRATION, history);
  const app = new StudioApplication({ document, eyeMakeup, gestures, controls, quality, history,
    ...viewServices, ...(options.presets ? { presets: options.presets } : {}), ...(options.lease ? { access: options.lease } : {}) }, STUDIO_REGISTRY);
  // The collection the scene shows: a working copy of one look in a library in memory (made at once; nothing is awaited).
  const store = openTestLibrary(), port = libraryPort(store), outbox = new DocumentOutbox(port, memoryOutboxStorage(), { retryMs: 5 });
  outbox.open();
  const owner = new CollectionOwner({ documents: port, outbox, versions: libraryVersions(store) });
  const collectionId = crypto.randomUUID(), lookId = crypto.randomUUID();
  owner.dispatch({ kind: "collection.create", id: collectionId, name: "Current", looks: [storedLook({ name: "Look", recipe: structuredClone(document.recipe) }, lookId)] });
  const scene = testScene({ collection: collectionId, look: lookId });
  const lookEditor = new LookEditor({ model: STUDIO_DOCUMENTS, sessions: new LookSessions(owner, outbox), document });
  let packageInput: PresetCollection | undefined;
  const transport: CollectionTransport = {
    list: async () => [], get: async () => { throw Error("No saved fixture collection."); },
    package: async (_action, input) => { const value = input as PresetCollection; packageInput = value;
      return eyeCheck(value, { presets: value.presets.map(preset => ({ id: preset.id, revision: preset.revision, appearance: "xfs_fixture" })) }); },
  };
  const downloads: string[] = [];
  let library!: CollectionApplication;
  const files = new StudioFileOperations({ pick: async () => undefined,
    download: (_blob, name) => downloads.push(name), bakeMask: async () => new Blob() }, {
    recipe: () => document.recipe, selectedLayer: () => document.recipe.layers[document.active],
    importRecipe: (value, name, collection) => library.importRecipe(value, name, collection),
    hasSavedV: () => false, savedV: () => undefined, loadSavedV: () => ({}),
    savedVReady: () => false, executeCollection: request => app.execute(request),
    recoverCollection: () => library.recover(),
  });
  library = new CollectionApplication({ model: STUDIO_DOCUMENTS, owner, scene, transport, flushLook: () => lookEditor.commit() }, document, app, files);
  // The input layer (profiles design §3.6): the port names what the scene shows and the editing context.
  const targets = fixtureTargets({ app, views: viewServices.views, history, document }, { scene, collection: () => library.service.draftIdentity()?.collectionId });
  lookEditor.show(scene.look());
  scene.subscribe(() => lookEditor.show(scene.look()));
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
    queryContext: hit => app.contextQuery(hit, targets.named()),
  });
  viewport.setReady("uv"); viewport.setReady("head");
  const preferences = new UIPreferenceActions(workspace.uiPreferences);
  const previewReadiness = { readiness: () => ({ phase: "ready" as const, size: 1024 as const,
    pending: 0, waiting: false, estimatedBytes: 1024, layers: [] }), subscribe: (_listener: () => void) => () => {} };
  return { shell: createStudioPresentation({ authoring: app, library, files, viewport, preferences,
    previewReadiness, targets, focus: history.focus, ...options.presentation, ...(options.lease ? { workspace: options.lease } : {}) }),
    packageInput: () => packageInput, downloads, locations, outbox };
}
