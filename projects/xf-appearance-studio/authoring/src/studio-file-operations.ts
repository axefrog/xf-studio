import type { CollectionOutcome, CollectionProgress, CollectionRequest, CollectionResult, CollectionService } from "./collection-service";
import type { PackageBuild, PackageCheck } from "./package-action";
import { parseRecipe, type Layer, type Recipe } from "./recipe";
import type { ReadonlyDeep } from "./read-only";
import type { SavedAppearanceState } from "./saved-appearance-actions";
import type { SavedV } from "./save-reader";

export type StudioFileKind = "recipe" | "collection" | "savedV";
export type StudioPickedFile = { name: string; size: number; text(): Promise<string>; bytes(): Promise<Uint8Array> };
export type StudioFilePort = {
  pick(kind: StudioFileKind): Promise<StudioPickedFile | undefined>;
  download(blob: Blob, name: string): void;
  bakeMask(layer: Layer): Promise<Blob>;
};
export type StudioFileAction =
  | { kind: "recipe.import" | "recipe.export" | "mask.export" | "savedV.import" | "savedV.export" }
  | { kind: "collection.import" | "collection.export" | "collection.plan" |
      "package.check" | "package.build" | "collection.recover" };
export type StudioFileOutcome = { ok: true; code: string; message: string;
  result?: CollectionResult;
  savedAppearance?: Readonly<SavedAppearanceState> } |
  { ok: false; code: string; message: string };
type PackageResult = { kind: "packageCheck"; result: PackageCheck } | { kind: "packageBuild"; result: PackageBuild };
export type StudioFileState = { busy?: StudioFileAction["kind"];
  collectionBusy: boolean;
  last?: { kind: StudioFileAction["kind"] | CollectionRequest["kind"];
    ok: boolean; code: string; message: string };
  package?: PackageResult & { freshness: "current" | "stale" };
  progress?: CollectionProgress;
  recovery: { available: boolean; reason?: string } };
type FileSources = {
  recipe(): ReadonlyDeep<Recipe>;
  selectedLayer(): ReadonlyDeep<Layer> | undefined;
  importRecipe(recipe: Recipe, name: string): void;
  hasSavedV(): boolean;
  savedV(): SavedV | undefined;
  loadSavedV(bytes: Uint8Array): Readonly<SavedAppearanceState>;
  savedVReady(): boolean;
  executeCollection(request: CollectionRequest): Promise<CollectionOutcome>;
  recoverCollection(): void;
};

/** File and package workflow contract; DOM, worker and download mechanics are injected. */
export class StudioFileOperations {
  private collection?: CollectionService;
  private collectionUnsubscribe?: () => void;
  private busy?: StudioFileAction["kind"];
  private last?: StudioFileState["last"];
  private package?: PackageResult;
  private listeners = new Set<() => void>();
  constructor(private port: StudioFilePort, private sources: FileSources) {}
  attachCollection(collection: CollectionService) {
    this.collectionUnsubscribe?.(); this.collection = collection;
    this.collectionUnsubscribe = collection.subscribe(() => this.notify()); this.notify();
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private notify() { for (const listener of this.listeners) listener(); }
  snapshot(): ReadonlyDeep<StudioFileState> {
    const collection = this.collection?.view(), progress = collection?.progress;
    const recovery = this.collection?.actionCapability({ kind: "collection.undoOpen" }) ??
      { available: false, reason: "Collection is still loading." };
    return structuredClone({ busy: this.busy, collectionBusy: collection?.busy ?? false,
      last: this.last, package: this.package && { ...this.package,
        freshness: this.collection?.lastPackageIsCurrent() ? "current" : "stale" },
      progress, recovery });
  }
  capability(action: StudioFileAction): { available: boolean; reason?: string } {
    if (this.busy) return { available: false, reason: "Another file operation is in progress." };
    switch (action.kind) {
      case "recipe.import": case "recipe.export": return { available: true };
      case "mask.export": return this.sources.selectedLayer() ? { available: true } :
        { available: false, reason: "Select a layer before exporting a mask." };
      case "savedV.import": return this.sources.savedVReady() ? { available: true } :
        { available: false, reason: "Wait for the preview assets to finish loading." };
      case "savedV.export": return this.sources.hasSavedV() ? { available: true } :
        { available: false, reason: "Load a saved V before exporting its appearance." };
      case "collection.recover": return this.collection?.actionCapability({ kind: "collection.undoOpen" }) ??
        { available: false, reason: "Collection is still loading." };
      default: {
        const request = collectionRequest(action.kind);
        return this.collection?.capability(request) ??
          { available: false, reason: "Collection is still loading." };
      }
    }
  }
  async execute(action: StudioFileAction): Promise<StudioFileOutcome> {
    const allowed = this.capability(action);
    if (!allowed.available) return this.finish(action.kind,
      { ok: false, code: this.busy ? "busy" : "unavailable", message: allowed.reason! });
    this.busy = action.kind; this.notify();
    try {
      let outcome: StudioFileOutcome;
      switch (action.kind) {
        case "recipe.import": {
          const file = await this.port.pick("recipe");
          if (!file) return this.finish(action.kind, { ok: false, code: "cancelled", message: "Recipe selection cancelled." });
          if (file.size > 1_000_000) throw new FileOperationError("too_large", "Recipe is too large.");
          const recipe = parseRecipe(JSON.parse(await file.text()));
          this.sources.importRecipe(recipe, file.name.replace(/\.json$/i, ""));
          outcome = { ok: true, code: "imported", message: `Opened ${file.name}` }; break;
        }
        case "recipe.export":
          this.port.download(new Blob([JSON.stringify(this.sources.recipe(), null, 2)],
            { type: "application/json" }), "xfs.recipe.json");
          outcome = { ok: true, code: "exported", message: "Recipe exported — editable shapes, colours and fields." }; break;
        case "mask.export": {
          const layer = structuredClone(this.sources.selectedLayer()!) as Layer;
          const blob = await this.port.bakeMask(layer);
          this.port.download(blob, `xfs-${layer.id}-alpha.png`);
          outcome = { ok: true, code: "exported", message: "Exported 2048² white + alpha mask; palette remains separate." }; break;
        }
        case "savedV.import": {
          const file = await this.port.pick("savedV");
          if (!file) return this.finish(action.kind, { ok: false, code: "cancelled", message: "Saved V selection cancelled." });
          if (file.size > 128 * 1024 * 1024) throw new FileOperationError("too_large", "Save is larger than the supported limit.");
          const savedAppearance = this.sources.loadSavedV(await file.bytes());
          outcome = { ok: true, code: "loaded", message: "Saved facial shape applied. Remaining appearance assets still need resolving.",
            savedAppearance }; break;
        }
        case "savedV.export":
          this.port.download(new Blob([JSON.stringify(this.sources.savedV(), null, 2)],
            { type: "application/json" }), "v-appearance.json");
          outcome = { ok: true, code: "exported", message: "Saved appearance exported." }; break;
        case "collection.recover":
          this.sources.recoverCollection();
          outcome = { ok: true, code: "recovered", message: "Previous collection draft restored." }; break;
        default: {
          let request: CollectionRequest;
          if (action.kind === "collection.import") {
            const file = await this.port.pick("collection");
            if (!file) return this.finish(action.kind, { ok: false, code: "cancelled", message: "Collection selection cancelled." });
            // Keep the service's exact size validation and error code.
            request = { kind: "import", text: file.size > 16_000_000 ? "" : await file.text(), bytes: file.size };
          } else request = collectionRequest(action.kind);
          if (request.kind === "package") this.package = undefined;
          const result = await this.sources.executeCollection(request);
          if (!result.ok) { outcome = result; break; }
          if (result.result.kind === "export")
            this.port.download(new Blob([result.result.json], { type: "application/json" }), result.result.name);
          if (result.result.kind === "packageCheck" || result.result.kind === "packageBuild")
            this.package = structuredClone(result.result);
          outcome = { ok: true, code: result.result.kind,
            message: this.collection?.view().progress?.message ?? "Collection operation completed.", result: result.result };
        }
      }
      return this.finish(action.kind, outcome);
    } catch (error) {
      const code = error instanceof FileOperationError ? error.code : error instanceof SyntaxError ? "invalid_json" : "file_failed";
      const prefix = action.kind === "recipe.import" ? "Could not open recipe: " :
        action.kind === "savedV.import" ? "Could not apply V: " : "";
      return this.finish(action.kind, { ok: false, code, message: prefix + (error as Error).message });
    }
  }
  /** Existing save/open/refresh requests share the same result/download state port. */
  async executeCollection(request: CollectionRequest): Promise<CollectionOutcome> {
    if (request.kind === "package") { this.package = undefined; this.notify(); }
    const result = await this.sources.executeCollection(request);
    if (result.ok && result.result.kind === "export")
      this.port.download(new Blob([result.result.json], { type: "application/json" }), result.result.name);
    if (result.ok && (result.result.kind === "packageCheck" || result.result.kind === "packageBuild"))
      this.package = structuredClone(result.result);
    this.last = { kind: request.kind === "package" ? request.action === "check" ? "package.check" : "package.build" :
      request.kind === "exportCollection" ? "collection.export" : request.kind === "exportPlan" ? "collection.plan" :
      request.kind === "import" ? "collection.import" : request.kind,
      ok: result.ok, code: result.ok ? result.result.kind : result.code,
      message: result.ok ? this.collection?.view().progress?.message ?? "Collection operation completed." : result.message };
    this.notify();
    return result;
  }
  private finish(kind: StudioFileAction["kind"], outcome: StudioFileOutcome): StudioFileOutcome {
    this.busy = undefined; this.last = { kind, ok: outcome.ok, code: outcome.code, message: outcome.message };
    this.notify(); return outcome;
  }
}

class FileOperationError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}
function collectionRequest(kind: StudioFileAction["kind"]): CollectionRequest {
  switch (kind) {
    case "collection.import": return { kind: "import", text: "", bytes: 0 };
    case "collection.export": return { kind: "exportCollection" };
    case "collection.plan": return { kind: "exportPlan" };
    case "package.check": return { kind: "package", action: "check" };
    case "package.build": return { kind: "package", action: "build" };
    default: return { kind: "initialize" };
  }
}
