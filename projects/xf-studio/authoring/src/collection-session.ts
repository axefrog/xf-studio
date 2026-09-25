import { COLLECTION_RECOVERY_LIMIT, collectionDraft, copyWorkspace, editPresets, emptyRecipe, liveFeatureStates, liveMemory, livePart,
  withLiveFeatures, withLiveMemory, withLivePart, type CollectionWorkspace, type DocumentModel, type EditorMemory,
  type PresetCommand } from "./collection-workspace";
import type { Recipe } from "./recipe";
import type { LiveFeatureState } from "./platform/core/live-features";
import type { LookCollection } from "./platform/api";
import type { StoredCollection } from "./collection-store";

/** The live editor document: its recipe (the look's eye-makeup part) and its memory for that look. */
export type EditorSnapshot = EditorMemory & { recipe: Recipe;
  /** The look's other registered features' live state; present only when the composition registers more features (step 5). */
  liveFeatures?: Record<string, LiveFeatureState>;
  /** Present when the look is locked (it holds a newer build's data): why, in plain words. Never written back. */
  liveLocked?: string };
/**
 * Owns draft switching independently of markup, network requests and renderer. The live
 * document edits one feature's part of the selected look; every other part and feature memory
 * of the look is kept as it is.
 *
 * `state` is an in-memory workspace (parsed by its reader, then changed only by validated
 * operations), so it is copied, never parsed again (CORE-35). Reads never write the live editor
 * into the draft (CORE-28): `snapshot()` applies it to its copy.
 */
export class CollectionSession {
  state: CollectionWorkspace;
  constructor(private model: DocumentModel, state: CollectionWorkspace, private read: () => EditorSnapshot,
    private show: (editor: EditorSnapshot) => void,
    /** The host's ID source for new looks (`editPresets` never invents one). */
    private newId: () => string = () => crypto.randomUUID()) {
    this.state = copyWorkspace(state);
  }
  /** Write the live editor into `state`'s selected look (the draft itself, or a copy of it). */
  private stashInto(state: CollectionWorkspace) {
    const preset = state.collection.presets.find(p => p.id === state.selected);
    // A locked look is never written from the editor: its parts and memory stay exactly as they were read.
    if (!preset || preset.locked) return;
    const { recipe, liveFeatures, ...memory } = this.read();
    preset.parts = withLivePart(preset, recipe, this.model);
    const written = withLiveFeatures(preset, withLiveMemory(state.memory[preset.id], structuredClone(memory), this.model),
      liveFeatures, this.model);
    preset.parts = written.parts;
    state.memory[preset.id] = written.memory;
  }
  stash() { this.stashInto(this.state); }
  /** A copy of the draft with the live editor's state in its selected look; the draft is not changed. */
  snapshot(): CollectionWorkspace {
    const copy = copyWorkspace(this.state);
    this.stashInto(copy);
    return copy;
  }
  display() {
    const preset = this.state.collection.presets.find(p => p.id === this.state.selected), recipe = livePart(preset, this.model);
    const memory = preset ? this.state.memory[preset.id] : undefined, others = liveFeatureStates(preset, memory, this.model);
    this.show({ recipe: recipe ? structuredClone(recipe) : emptyRecipe(),
      ...structuredClone(liveMemory(memory, this.model)), ...(others ? { liveFeatures: others } : {}),
      ...(preset?.locked ? { liveLocked: preset.locked } : {}) });
  }
  select(id: string) {
    if (!this.state.collection.presets.some(p => p.id === id)) throw Error("Preset not found.");
    this.stash(); this.state.selected = id; this.display();
  }
  renameCollection(name: string) {
    this.stash();
    this.state.collection = this.model.parts.readCollection({ ...this.state.collection, name: name.trim() }, true, "keep");
  }
  edit(command: PresetCommand) {
    this.stash(); const previous = this.state.selected;
    const concrete = (command.kind === "add" || command.kind === "copy") && !command.newId ? { ...command, newId: this.newId() } : command;
    this.state = editPresets(this.state, concrete, this.model);
    if (previous !== this.state.selected || command.kind === "restore") this.display();
  }
  open(collection: LookCollection | unknown, revision?: number) {
    const { previous, older, ...current } = this.snapshot();
    const recovery = [current, ...(previous ? [previous] : []), ...(older ?? [])].slice(0, COLLECTION_RECOVERY_LIMIT);
    this.state = { ...collectionDraft(collection, this.model, revision), previous: recovery[0], older: recovery.slice(1) };
    this.display();
  }
  undoOpen() {
    if (!this.state.previous) throw Error("No previous collection draft.");
    const { previous, older, ...current } = this.snapshot();
    const recovery = [...(older ?? []), current];
    this.state = { ...previous!, previous: recovery[0], older: recovery.slice(1) };
    this.display();
  }
  importRecipe(recipe: Recipe, name: string) {
    this.edit({ kind: "add" });
    const preset = this.state.collection.presets.find(p => p.id === this.state.selected)!;
    preset.name = name.trim().slice(0, 120) || "Imported preset";
    preset.parts = withLivePart(preset, recipe, this.model); this.display();
  }
  saved(result: StoredCollection, sourceId: string) {
    // In-flight edits survive: only reconcile persisted identity/revision metadata.
    if (this.state.collection.id !== sourceId) throw Error("Saved another collection snapshot; current draft kept.");
    this.state.collection.id = result.collection.id; this.state.revision = result.revision;
    const revisions = new Map(result.collection.presets.map(p => [p.id, p.revision]));
    for (const preset of this.state.collection.presets) preset.revision = revisions.get(preset.id) ?? preset.revision;
  }
}
