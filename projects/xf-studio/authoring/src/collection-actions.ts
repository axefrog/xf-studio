import { CollectionSession, type EditorSnapshot } from "./collection-session";
import { COLLECTION_RECOVERY_LIMIT } from "./collection-workspace";
import type { CollectionWorkspace, PresetCommand } from "./collection-workspace";
import type { PresetCollection } from "./preset-collection";
import type { StoredCollection } from "./collection-store";
import type { Recipe } from "./recipe";
import { nameIssue, positionIssue, refuse, type ValidationIssue } from "./validation-issues";

export type CollectionAction =
  | { kind: "preset.edit"; command: PresetCommand }
  | { kind: "preset.select"; id: string }
  | { kind: "collection.rename"; name: string }
  | { kind: "collection.open"; collection: PresetCollection; revision?: number }
  | { kind: "collection.undoOpen" }
  | { kind: "collection.importRecipe"; recipe: Recipe; name: string }
  | { kind: "collection.saved"; result: StoredCollection; sourceId: string };

export type ActionCapability = { available: boolean; reason?: string; issue?: ValidationIssue };
/** Primitive-only draft projection; building it never clones recipes or Undo histories. */
export type CollectionDraftSummary = {
  id: string; name: string; revision?: number; selected?: string;
  presets: { id: string; name: string; revision: number; layers: number }[];
  /** Oldest first; `restore` brings back the last entry. */
  removed: { id: string; name: string; index: number }[];
  previous?: { id: string; name: string; revision?: number };
  recoveryCount: number; recoveryLimit: number;
  oldestRecoverable?: { id: string; name: string; revision?: number };
};
export type ReadonlyDeep<T> = T extends (infer U)[] ? readonly ReadonlyDeep<U>[] :
  T extends object ? { readonly [K in keyof T]: ReadonlyDeep<T[K]> } : T;

/** In-process collection command boundary. Returned views cannot mutate the live draft. */
export class CollectionActions {
  private session: CollectionSession;
  private listeners = new Set<() => void>();

  constructor(state: CollectionWorkspace, read: () => EditorSnapshot, show: (editor: EditorSnapshot) => void) {
    this.session = new CollectionSession(state, read, show);
  }

  view(): ReadonlyDeep<CollectionWorkspace> { return structuredClone(this.session.state); }
  /** The selected preset's stored layer count can lag the live editor; callers may patch it. */
  summary(): CollectionDraftSummary {
    const s = this.session.state;
    const recovery = [...(s.previous ? [s.previous] : []), ...(s.older ?? [])];
    const oldest = recovery.at(-1);
    return { id: s.collection.id, name: s.collection.name, revision: s.revision, selected: s.selected,
      presets: s.collection.presets.map(p => ({ id: p.id, name: p.name, revision: p.revision,
        layers: p.recipe.layers.length })),
      removed: s.removed.map(entry => ({ id: entry.preset.id, name: entry.preset.name, index: entry.index })),
      previous: s.previous ? { id: s.previous.collection.id, name: s.previous.collection.name,
        revision: s.previous.revision } : undefined,
      recoveryCount: recovery.length, recoveryLimit: COLLECTION_RECOVERY_LIMIT,
      oldestRecoverable: oldest ? { id: oldest.collection.id, name: oldest.collection.name,
        revision: oldest.revision } : undefined };
  }
  snapshot(): CollectionWorkspace { return this.session.snapshot(); }
  /** Trusted, uncloned preset list for the service's own comparisons. Never hand it to a view. */
  presetsForComparison(): readonly { readonly id: string; readonly name: string; readonly recipe: Recipe }[] {
    return this.session.state.collection.presets;
  }
  /** Selected preset ID without cloning; undefined when the collection has no selected preset. */
  selected(): string | undefined { return this.session.state.selected; }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  capability(action: CollectionAction): ActionCapability {
    const state = this.session.state;
    if (action.kind === "collection.undoOpen" && !state.previous)
      return { available: false, reason: "No previous collection draft." };
    if (action.kind === "preset.edit") {
      const command = action.command;
      if (command.kind === "restore" && !state.removed.length)
        return { available: false, reason: "No removed preset to restore." };
      if ("id" in command && !state.collection.presets.some(p => p.id === command.id))
        return { available: false, reason: "That preset no longer exists." };
      const issue = command.kind === "move" ? positionIssue(command.to, state.collection.presets.length,
        { below: "This preset is already first.", above: "This preset is already last." }) :
        command.kind === "rename" ? nameIssue(command.name, 120) : undefined;
      if (issue) return refuse(issue);
    }
    if (action.kind === "collection.rename") {
      const issue = nameIssue(action.name, 120);
      if (issue) return refuse(issue);
    }
    if (action.kind === "preset.select" && !state.collection.presets.some(p => p.id === action.id))
      return { available: false, reason: "Preset not found." };
    return { available: true };
  }

  dispatch(action: CollectionAction): void {
    const capability = this.capability(action);
    if (!capability.available) throw Error(capability.reason);
    switch (action.kind) {
      case "preset.edit": this.session.edit(action.command); break;
      case "preset.select": this.session.select(action.id); break;
      case "collection.rename": this.session.renameCollection(action.name); break;
      case "collection.open": this.session.open(action.collection, action.revision); break;
      case "collection.undoOpen": this.session.undoOpen(); break;
      case "collection.importRecipe": this.session.importRecipe(action.recipe, action.name); break;
      case "collection.saved": this.session.saved(action.result, action.sourceId); break;
    }
    for (const listener of this.listeners) listener();
  }
}
