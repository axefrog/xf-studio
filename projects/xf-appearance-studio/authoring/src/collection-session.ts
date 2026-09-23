import { collectionDraft, editPresets, emptyMemory, emptyRecipe, parseCollectionWorkspace,
  type CollectionWorkspace, type EditorMemory, type PresetCommand } from "./collection-workspace";
import { parseRecipe, type Recipe } from "./recipe";
import { parseCollection, type PresetCollection } from "./preset-collection";
import type { StoredCollection } from "./collection-store";

export type EditorSnapshot = EditorMemory & { recipe: Recipe };
/** Owns draft switching independently of markup, network requests and renderer. */
export class CollectionSession {
  state: CollectionWorkspace;
  constructor(state: CollectionWorkspace, private read: () => EditorSnapshot, private show: (editor: EditorSnapshot) => void) {
    this.state = parseCollectionWorkspace(state);
  }
  stash() {
    const preset = this.state.collection.presets.find(p => p.id === this.state.selected);
    if (!preset) return;
    const { recipe, ...memory } = this.read();
    preset.recipe = parseRecipe(recipe); this.state.editors[preset.id] = structuredClone(memory);
  }
  snapshot() { this.stash(); return parseCollectionWorkspace(this.state); }
  display() {
    const preset = this.state.collection.presets.find(p => p.id === this.state.selected);
    this.show({ recipe: preset ? structuredClone(preset.recipe) : emptyRecipe(),
      ...structuredClone(preset ? this.state.editors[preset.id] ?? emptyMemory() : emptyMemory()) });
  }
  select(id: string) {
    if (!this.state.collection.presets.some(p => p.id === id)) throw Error("Preset not found.");
    this.stash(); this.state.selected = id; this.state.expanded = true; this.display();
  }
  setExpanded(expanded: boolean) { this.state.expanded = expanded; }
  setFilesOpen(open: boolean) { this.state.filesOpen = open; }
  renameCollection(name: string) {
    this.stash();
    this.state.collection = parseCollection({ ...this.state.collection, name: name.trim() }, true);
  }
  edit(command: PresetCommand) {
    this.stash(); const previous = this.state.selected;
    this.state = editPresets(this.state, command);
    if (previous !== this.state.selected || command.kind === "restore") this.display();
  }
  open(collection: PresetCollection, revision?: number) {
    const { previous: _discard, ...previous } = this.snapshot();
    this.state = { ...collectionDraft(collection, revision), previous, filesOpen: this.state.filesOpen };
    this.display();
  }
  undoOpen() {
    if (!this.state.previous) throw Error("No previous collection draft.");
    const previous = this.state.previous, { previous: _discard, ...current } = this.snapshot();
    this.state = { ...previous, previous: current, filesOpen: this.state.filesOpen }; this.display();
  }
  importRecipe(recipe: Recipe, name: string) {
    this.edit({ kind: "add" });
    const preset = this.state.collection.presets.find(p => p.id === this.state.selected)!;
    preset.name = name.trim().slice(0, 120) || "Imported preset"; preset.recipe = parseRecipe(recipe); this.display();
  }
  saved(result: StoredCollection, sourceId: string) {
    // In-flight edits survive: only reconcile persisted identity/revision metadata.
    if (this.state.collection.id !== sourceId) throw Error("Saved another collection snapshot; current draft kept.");
    this.state.collection.id = result.collection.id; this.state.revision = result.revision;
    const revisions = new Map(result.collection.presets.map(p => [p.id, p.revision]));
    for (const preset of this.state.collection.presets) preset.revision = revisions.get(preset.id) ?? preset.revision;
  }
}
