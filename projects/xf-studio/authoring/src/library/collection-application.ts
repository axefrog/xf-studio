import type { AuthoringDocument } from "../app/authoring/authoring-document";
import type { CollectionAction } from "./collection-actions";
import type { Unnamed } from "../app/action-targets";
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
  /** A collection action; its `collection` may be left for the port to name (the collection the Presets panel shows). */
  capability(action: Unnamed<CollectionAction>): ReturnType<StudioApplication["capability"]>;
  dispatch(action: Unnamed<CollectionAction>): ReturnType<StudioApplication["dispatch"]>;
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
  /** The trusted service (the composition root and tests); views get only `CollectionViewPort`. */
  readonly service: CollectionService;
  private readonly model: CollectionServiceDeps["model"];
  constructor(deps: Omit<CollectionServiceDeps, "readRecipe">, private document: Pick<AuthoringDocument, "features" | "version">, private app: StudioApplication,
    private files: StudioFileOperations) {
    this.model = deps.model;
    this.service = new CollectionService({ ...deps, readParts: () => ({ revision: document.version,
      parts: Object.fromEntries(document.features.features().map(feature => [feature, document.features.read(feature)])) }) });
    // Library requests and file workflows route through the application's registry (CORE-36).
    app.attach({ collection: this.service, files });
    files.attachCollection(this.service);
  }
  view() { return this.service.view(); }
  summary() {
    const summary = this.service.summary(), selected = summary.draft?.selected;
    for (const preset of summary.draft?.presets ?? [])
      if (preset.id === selected) preset.layers = this.currentLayerCount();
    return summary;
  }
  subscribe(listener: () => void) { return this.files.subscribe(listener); }
  /** The shown preset's ID; undefined while loading or with no preset shown. */
  selectedPresetId() { return this.service.selectedPreset().id; }
  persistence() { return this.service.persistence(); }
  currentLayerCount() {
    const feature = this.model.live, document = feature ? this.document.features.document(feature) : undefined;
    return document?.part === undefined ? 0 : Number(document.module.part.summary(document.part).layers ?? 0);
  }
  capability(action: Unnamed<CollectionAction>) { return this.app.capability(action as CollectionAction); }
  dispatch(action: Unnamed<CollectionAction>) { return this.app.dispatch(action as CollectionAction); }
  fileCapability(action: StudioFileAction) { return this.app.fileCapability(action); }
  fileExecute(action: StudioFileAction) { return this.app.executeFile(action); }
  execute(request: CollectionRequest) { return this.files.executeCollection(request); }
  initialize() { return this.execute({ kind: "initialize" }); }
  /** The collection shown (the Presets panel's), which its own requests name; undefined while loading. */
  private shown() { return this.service.draftIdentity()?.collectionId ?? ""; }
  /** Import a recipe as a new preset of `collection` (the one the import named when it was asked). */
  importRecipe(recipe: Recipe, name: string, collection: string) {
    const outcome = this.dispatch({ kind: "collection.importRecipe", collection, recipe, name });
    if (!outcome.ok) throw Error(outcome.message);
  }
  recover(draft?: string) {
    const outcome = this.dispatch({ kind: "collection.undoOpen", collection: this.shown(), ...(draft !== undefined ? { draft } : {}) });
    if (!outcome.ok) throw Error(outcome.message);
  }
  dispose() { this.service.dispose(); }
}
