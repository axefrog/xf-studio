import { CollectionSession, type EditorSnapshot } from "./collection-session";
import { COLLECTION_RECOVERY_LIMIT } from "./collection-workspace";
import type { CollectionWorkspace, DocumentModel, PresetCommand } from "./collection-workspace";
import type { StoredCollection } from "./collection-store";
import type { Look, LookCollection } from "./platform/api";
import type { Recipe } from "./recipe";
import { nameIssue, positionIssue, refuse, type ValidationIssue } from "./validation-issues";
import { refusal, type ReasonCode } from "./platform/api";

export type CollectionAction =
  | { kind: "preset.edit"; command: PresetCommand }
  | { kind: "preset.select"; id: string }
  | { kind: "collection.rename"; name: string }
  /** A stored collection of either schema (`xfas/collection-1` or `xfs/collection-2`). */
  | { kind: "collection.open"; collection: LookCollection | unknown; revision?: number }
  | { kind: "collection.undoOpen" }
  | { kind: "collection.importRecipe"; recipe: Recipe; name: string }
  | { kind: "collection.saved"; result: StoredCollection; sourceId: string };
/** Collection actions a presentation may dispatch; `collection.saved` is the library's own completion. */
export type CollectionStudioAction = Exclude<CollectionAction, { kind: "collection.saved" }>;

export type ActionCapability = { available: boolean; reason?: string; issue?: ValidationIssue };
/** A capability with the reason code chosen where it was refused (`platform/api`). */
export type CodedCapability = ActionCapability & { code?: ReasonCode };
/** Primitive-only draft projection; building it never clones recipes or Undo histories. */
export type CollectionDraftSummary = {
  id: string; name: string; revision?: number; selected?: string;
  /** `locked`: the look holds a newer build's data and is not editable in this version. */
  presets: { id: string; name: string; revision: number; layers: number; locked?: true }[];
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

  constructor(private model: DocumentModel, state: CollectionWorkspace, read: () => EditorSnapshot,
    show: (editor: EditorSnapshot) => void,
    /** The host's ID source for new looks; defaults to random UUIDs. */
    newId?: () => string) {
    this.session = new CollectionSession(model, state, read, show, newId);
  }

  view(): ReadonlyDeep<CollectionWorkspace> { return structuredClone(this.session.state); }
  /** The selected preset's stored layer count can lag the live editor; callers may patch it. */
  summary(): CollectionDraftSummary {
    const s = this.session.state;
    const recovery = [...(s.previous ? [s.previous] : []), ...(s.older ?? [])];
    const oldest = recovery.at(-1);
    return { id: s.collection.id, name: s.collection.name, revision: s.revision, selected: s.selected,
      presets: s.collection.presets.map(p => ({ id: p.id, name: p.name, revision: p.revision,
        layers: Number(this.model.parts.summary(p, this.model.live)?.layers ?? 0), ...(p.locked ? { locked: true as const } : {}) })),
      removed: s.removed.map(entry => ({ id: entry.preset.id, name: entry.preset.name, index: entry.index })),
      previous: s.previous ? { id: s.previous.collection.id, name: s.previous.collection.name,
        revision: s.previous.revision } : undefined,
      recoveryCount: recovery.length, recoveryLimit: COLLECTION_RECOVERY_LIMIT,
      oldestRecoverable: oldest ? { id: oldest.collection.id, name: oldest.collection.name,
        revision: oldest.revision } : undefined };
  }
  snapshot(): CollectionWorkspace { return this.session.snapshot(); }
  /** Trusted, uncloned look list for the service's own comparisons. Never hand it to a view. */
  presetsForComparison(): readonly Readonly<Look>[] {
    return this.session.state.collection.presets;
  }
  /** Selected preset ID without cloning; undefined when the collection has no selected preset. */
  selected(): string | undefined { return this.session.state.selected; }
  /** Draft identity without cloning (CORE-05): the collection ID and the selected preset. */
  identity(): { collectionId: string; selected?: string } {
    return { collectionId: this.session.state.collection.id, selected: this.session.state.selected };
  }
  /** The draft's saved library revision (undefined before its first save), without cloning. */
  summaryRevision(): number | undefined { return this.session.state.revision; }
  /** Whether the draft has this preset, without cloning (CORE-05). */
  hasPreset(id: string): boolean { return this.session.state.collection.presets.some(preset => preset.id === id); }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The existing uncoded capability shape; the application reads the coded `check()`. */
  capability(action: CollectionAction): ActionCapability {
    const { code: _code, ...capability } = this.check(action);
    return capability;
  }
  /** Capability with a structured reason code (issues imply theirs; see `platform/api` `coded`). */
  check(action: CollectionAction): CodedCapability {
    const state = this.session.state;
    if (action.kind === "collection.undoOpen" && !state.previous)
      return refusal("invalid_value", "No previous collection draft.");
    if (action.kind === "preset.edit") {
      const command = action.command;
      if (command.kind === "restore" && !state.removed.length)
        return refusal("invalid_value", "No removed preset to restore.");
      if ("id" in command && !state.collection.presets.some(p => p.id === command.id))
        return refusal("missing_target", "That preset no longer exists.");
      const newId = "newId" in command ? command.newId : undefined;
      if (newId && (state.collection.presets.some(p => p.id === newId) || state.removed.some(entry => entry.preset.id === newId)))
        return refusal("invalid_value", "That preset ID is already in use.");
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
      return refusal("missing_target", "Preset not found.");
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
