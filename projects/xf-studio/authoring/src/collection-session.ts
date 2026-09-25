import { STUDIO_PARTS } from "./compose/studio-registry";
import { COLLECTION_RECOVERY_LIMIT, collectionDraft, editPresets, emptyRecipe, liveMemory, livePart,
  parseCollectionWorkspace, withLiveMemory, withLivePart, type CollectionWorkspace, type EditorMemory,
  type PresetCommand } from "./collection-workspace";
import type { Recipe } from "./recipe";
import type { LookCollection } from "./platform/api";
import type { StoredCollection } from "./collection-store";

/** The live editor document: its recipe (the look's eye-makeup part) and its memory for that look. */
export type EditorSnapshot = EditorMemory & { recipe: Recipe };
/**
 * Owns draft switching independently of markup, network requests and renderer. The live
 * document edits one feature's part of the selected look; every other part and feature memory
 * of the look is kept as it is.
 */
export class CollectionSession {
  state: CollectionWorkspace;
  constructor(state: CollectionWorkspace, private read: () => EditorSnapshot, private show: (editor: EditorSnapshot) => void) {
    this.state = parseCollectionWorkspace(state);
  }
  stash() {
    const preset = this.state.collection.presets.find(p => p.id === this.state.selected);
    if (!preset) return;
    const { recipe, ...memory } = this.read();
    preset.parts = withLivePart(preset, recipe);
    this.state.memory[preset.id] = withLiveMemory(this.state.memory[preset.id], structuredClone(memory));
  }
  snapshot() { this.stash(); return parseCollectionWorkspace(this.state); }
  display() {
    const preset = this.state.collection.presets.find(p => p.id === this.state.selected), recipe = livePart(preset);
    this.show({ recipe: recipe ? structuredClone(recipe) : emptyRecipe(),
      ...structuredClone(liveMemory(preset ? this.state.memory[preset.id] : undefined)) });
  }
  select(id: string) {
    if (!this.state.collection.presets.some(p => p.id === id)) throw Error("Preset not found.");
    this.stash(); this.state.selected = id; this.display();
  }
  renameCollection(name: string) {
    this.stash();
    this.state.collection = STUDIO_PARTS.readCollection({ ...this.state.collection, name: name.trim() }, true);
  }
  edit(command: PresetCommand) {
    this.stash(); const previous = this.state.selected;
    this.state = editPresets(this.state, command);
    if (previous !== this.state.selected || command.kind === "restore") this.display();
  }
  open(collection: LookCollection | unknown, revision?: number) {
    const { previous, older, ...current } = this.snapshot();
    const recovery = [current, ...(previous ? [previous] : []), ...(older ?? [])].slice(0, COLLECTION_RECOVERY_LIMIT);
    this.state = { ...collectionDraft(collection, revision), previous: recovery[0], older: recovery.slice(1) };
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
    preset.parts = withLivePart(preset, recipe); this.display();
  }
  saved(result: StoredCollection, sourceId: string) {
    // In-flight edits survive: only reconcile persisted identity/revision metadata.
    if (this.state.collection.id !== sourceId) throw Error("Saved another collection snapshot; current draft kept.");
    this.state.collection.id = result.collection.id; this.state.revision = result.revision;
    const revisions = new Map(result.collection.presets.map(p => [p.id, p.revision]));
    for (const preset of this.state.collection.presets) preset.revision = revisions.get(preset.id) ?? preset.revision;
  }
}
