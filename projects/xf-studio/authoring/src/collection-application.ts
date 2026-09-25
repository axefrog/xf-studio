import type { AuthoringDocument } from "./authoring-document";
import type { CollectionAction } from "./collection-actions";
import { CollectionService, type CollectionOutcome, type CollectionRequest,
  type CollectionServiceState, type CollectionServiceSummary, type CollectionTransport,
  type DraftPersistence } from "./collection-service";
import type { CollectionWorkspace, DocumentModel } from "./collection-workspace";
import type { ReadonlyDeep } from "./read-only";
import type { Recipe } from "./recipe";
import type { StudioApplication } from "./studio-application";
import type { StudioFileAction, StudioFileOperations, StudioFileOutcome } from "./studio-file-operations";
import type { LibraryState } from "./workspace-state";

type ViewAction = Exclude<CollectionAction, { kind: "collection.saved" }>;
export type CollectionViewPort = {
  view(): ReadonlyDeep<CollectionServiceState>;
  /** Primitive-only projection for repainting lists; the selected preset uses its live layer count. */
  summary(): ReadonlyDeep<CollectionServiceSummary>;
  /** Draft versus library revision: saved revision, dirty presets and structure (undefined while loading). */
  persistence(): DraftPersistence | undefined;
  subscribe(listener: () => void): () => void;
  capability(action: ViewAction): ReturnType<StudioApplication["capability"]>;
  dispatch(action: ViewAction): ReturnType<StudioApplication["dispatch"]>;
  fileCapability(action: StudioFileAction): ReturnType<StudioFileOperations["capability"]>;
  fileExecute(action: StudioFileAction): Promise<StudioFileOutcome>;
  execute(request: CollectionRequest): Promise<CollectionOutcome>;
  currentLayerCount(): number;
};

/** Trusted collection/editor composition. The view receives only CollectionViewPort. */
export class CollectionApplication implements CollectionViewPort {
  private service: CollectionService;
  constructor(model: DocumentModel, restored: CollectionWorkspace | undefined, legacy: LibraryState,
    private document: AuthoringDocument, onEditorRestored: () => void,
    transport: CollectionTransport, private app: StudioApplication,
    private files: StudioFileOperations) {
    this.service = new CollectionService(model, restored, legacy,
      () => document.export(), editor => {
        document.restore({ ...editor, fieldSelection: editor.fieldSelection ?? {} });
        onEditorRestored();
      }, transport, () => ({ recipe: document.recipe, revision: document.geometryVersion.revision }));
    app.attach({ collection: this.service });
    files.attachCollection(this.service);
  }
  view() { return this.service.view(); }
  summary() {
    const summary = this.service.summary(), selected = summary.draft?.selected;
    for (const preset of summary.draft?.presets ?? [])
      if (preset.id === selected) preset.layers = this.document.recipe.layers.length;
    return summary;
  }
  subscribe(listener: () => void) { return this.files.subscribe(listener); }
  workspaceSnapshot() { return this.service.snapshot(); }
  /** The selected preset's ID without copying the draft; undefined while loading or with no preset selected. */
  selectedPresetId() { return this.service.selectedPreset().id; }
  persistence() { return this.service.persistence(); }
  currentLayerCount() { return this.document.recipe.layers.length; }
  capability(action: ViewAction) { return this.app.capability(action); }
  dispatch(action: ViewAction) { return this.app.dispatch(action); }
  fileCapability(action: StudioFileAction) { return this.files.capability(action); }
  fileExecute(action: StudioFileAction) { return this.files.execute(action); }
  execute(request: CollectionRequest) { return this.files.executeCollection(request); }
  initialize() { return this.execute({ kind: "initialize" }); }
  importRecipe(recipe: Recipe, name: string) {
    const outcome = this.dispatch({ kind: "collection.importRecipe", recipe, name });
    if (!outcome.ok) throw Error(outcome.message);
  }
  recover() {
    const outcome = this.dispatch({ kind: "collection.undoOpen" });
    if (!outcome.ok) throw Error(outcome.message);
  }
}
