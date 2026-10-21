import type { AuthoringDocument } from "../app/authoring/authoring-document";
import type { CollectionAction } from "./collection-actions";
import { CollectionService, type CollectionOutcome, type CollectionRequest, type CollectionServiceDeps,
  type CollectionServiceState, type CollectionServiceSummary, type DraftPersistence } from "./collection-service";
import type { ReadonlyDeep } from "../platform/api/read-only";
import type { Recipe } from "../engines/layered-makeup/recipe";
import type { StudioApplication } from "../app/studio-application";
import type { StudioFileAction, StudioFileOperations, StudioFileOutcome } from "../app/studio-file-operations";

export type CollectionViewPort = {
  view(): ReadonlyDeep<CollectionServiceState>;
  /** Primitive-only projection for repainting lists; the shown preset uses its live layer count. */
  summary(): ReadonlyDeep<CollectionServiceSummary>;
  /** The shown collection against its last saved version: saved revision, dirty presets and structure (undefined while loading). */
  persistence(): DraftPersistence | undefined;
  subscribe(listener: () => void): () => void;
  capability(action: CollectionAction): ReturnType<StudioApplication["capability"]>;
  dispatch(action: CollectionAction): ReturnType<StudioApplication["dispatch"]>;
  fileCapability(action: StudioFileAction): ReturnType<StudioFileOperations["capability"]>;
  fileExecute(action: StudioFileAction): Promise<StudioFileOutcome>;
  execute(request: CollectionRequest): Promise<CollectionOutcome>;
  currentLayerCount(): number;
};

/**
 * Trusted collection composition: the collection service over the collection owner, the scene's look and the live editor document. The
 * view receives only `CollectionViewPort`.
 */
export class CollectionApplication implements CollectionViewPort {
  private service: CollectionService;
  constructor(deps: Omit<CollectionServiceDeps, "readRecipe">, private document: AuthoringDocument, private app: StudioApplication,
    private files: StudioFileOperations) {
    this.service = new CollectionService({ ...deps, readRecipe: () => {
      const others = document.otherParts();
      return { recipe: document.recipe, revision: document.geometryVersion.revision, ...(others ? { others } : {}) };
    } });
    // Library requests and file workflows route through the application's registry (CORE-36).
    app.attach({ collection: this.service, files });
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
  /** The shown preset's ID; undefined while loading or with no preset shown. */
  selectedPresetId() { return this.service.selectedPreset().id; }
  persistence() { return this.service.persistence(); }
  currentLayerCount() { return this.document.recipe.layers.length; }
  capability(action: CollectionAction) { return this.app.capability(action); }
  dispatch(action: CollectionAction) { return this.app.dispatch(action); }
  fileCapability(action: StudioFileAction) { return this.app.fileCapability(action); }
  fileExecute(action: StudioFileAction) { return this.app.executeFile(action); }
  execute(request: CollectionRequest) { return this.files.executeCollection(request); }
  initialize() { return this.execute({ kind: "initialize" }); }
  importRecipe(recipe: Recipe, name: string) {
    const outcome = this.dispatch({ kind: "collection.importRecipe", recipe, name });
    if (!outcome.ok) throw Error(outcome.message);
  }
  recover(draft?: string) {
    const outcome = this.dispatch({ kind: "collection.undoOpen", ...(draft !== undefined ? { draft } : {}) });
    if (!outcome.ok) throw Error(outcome.message);
  }
  dispose() { this.service.dispose(); }
}
