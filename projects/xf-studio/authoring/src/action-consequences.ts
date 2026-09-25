import type { CollectionDraftSummary } from "./collection-actions";
import type { CollectionRequest } from "./collection-service";
import type { HistoryJumpPlan, HistoryState } from "./authoring-history";
import { FILE_DESCRIPTORS } from "./studio-action-descriptors";
import type { ActionEffect, ConsequenceOverride } from "./platform/api";
import type { StudioAction } from "./studio-application";
import type { StudioFileAction } from "./studio-file-operations";

/**
 * What an action replaces, writes or permanently discards, and how to get back (audit A-2).
 * Presentations use it to decide on confirmation and to word Undo hints; the domain rules
 * behind it (recovery queue size, removal stack, Undo depth) stay in their services.
 */
export type Consequence = {
  replaces?: "draft" | "preset" | "layer-content";
  /** Durable side effects outside the browser draft. */
  writes?: "library-revision" | "private-files";
  /**
   * Recoverable state that this action pushes out of reach. A recovery draft carries its collection `id`, and
   * `locked` when it holds a look made with a newer version (the library can't take it, so the draft may be its
   * only copy; CORE-49).
   */
  discards: { kind: "recovery-draft" | "removed-preset" | "undo-entry" | "redo"; label: string; id?: string; locked?: true }[];
  recoverableBy: "history.undo" | "history.redo" | "preset.restore" | "collection.undoOpen" | "none";
  /** True only when something recoverable would be lost for good. */
  confirm: boolean;
};
export type ConsequenceSubject = { action: StudioAction } | { file: StudioFileAction } | { request: CollectionRequest };
type State = { draft?: CollectionDraftSummary; history: HistoryState; undoLimit: number; removedLimit: number;
  /** For `history.jumpTo`: which way the jump goes. */
  jump?: HistoryJumpPlan;
  /** The action's registered effect and its spec's consequence override (feature-module platform §4). */
  action?: { effect: ActionEffect; override?: ConsequenceOverride } };

export function consequenceOf(subject: ConsequenceSubject, state: State): Consequence {
  const none: Consequence = { discards: [], recoverableBy: "none", confirm: false };
  const done = (value: Omit<Consequence, "confirm">): Consequence => ({ ...value, confirm: value.discards.some(item =>
    item.kind === "recovery-draft" || item.kind === "removed-preset") });
  const draft = state.draft;
  // Opening or importing adds the current draft to a bounded queue; at capacity the oldest goes.
  const replaceDraft = () => done({ replaces: "draft", recoverableBy: "collection.undoOpen",
    discards: draft && draft.recoveryCount >= draft.recoveryLimit && draft.oldestRecoverable
      ? [{ kind: "recovery-draft", label: draft.oldestRecoverable.name, id: draft.oldestRecoverable.id,
        ...(draft.oldestRecoverable.locked ? { locked: true as const } : {}) }] : [] });
  if ("request" in subject) {
    const request = subject.request;
    if (request.kind === "open" || request.kind === "import") return replaceDraft();
    if (request.kind === "save" || request.kind === "saveCopy" || request.kind === "exportCollection" || request.kind === "exportPlan")
      return { ...none, writes: "library-revision" };
    if (request.kind === "package" && request.action === "build") return { ...none, writes: "private-files" };
    return none;
  }
  if ("file" in subject) {
    const kind = subject.file.kind;
    if (kind === "collection.import") return replaceDraft();
    if (kind === "collection.recover") return done({ replaces: "draft", recoverableBy: "collection.undoOpen", discards: [] });
    if (kind === "recipe.import") return { ...none, replaces: "preset" };
    if (FILE_DESCRIPTORS[kind].savesFirst) return { ...none, writes: "library-revision" };
    if (kind === "package.build") return { ...none, writes: "private-files" };
    return none;
  }
  const action = subject.action;
  if (action.kind === "collection.open") return replaceDraft();
  if (action.kind === "collection.undoOpen") return done({ replaces: "draft", recoverableBy: "collection.undoOpen", discards: [] });
  if (action.kind === "preset.edit" && action.command.kind === "remove") {
    const removed = draft?.removed ?? [];
    return done({ replaces: "preset", recoverableBy: "preset.restore",
      discards: removed.length >= state.removedLimit && removed[0] ? [{ kind: "removed-preset", label: removed[0].name }] : [] });
  }
  if (action.kind === "history.undo") return done({ replaces: "layer-content", discards: [],
    recoverableBy: state.history.undo ? "history.redo" : "none" });
  if (action.kind === "history.redo") return done({ replaces: "layer-content", discards: [], recoverableBy: "history.undo" });
  // A jump is a run of Undo or Redo steps: nothing is discarded, and the steps stay reachable.
  if (action.kind === "history.jumpTo") return done({ replaces: "layer-content", discards: [],
    recoverableBy: state.jump?.direction === "redo" ? "history.undo" : state.jump?.direction === "undo" ? "history.redo" : "none" });
  if (state.action?.effect !== "content") return none;
  // Every other content edit records one Undo entry; it drops Redo and, at the bound, the oldest Undo.
  const discards: Consequence["discards"] = [];
  if (state.history.redo) discards.push({ kind: "redo", label: state.history.redo.label });
  if (state.history.depth >= state.undoLimit) discards.push({ kind: "undo-entry", label: "Oldest Undo step" });
  // What else it replaces is the spec's to say (for eye makeup, removals and resets replace layer content).
  return done({ ...(state.action.override?.replaces ? { replaces: state.action.override.replaces } : {}), recoverableBy: "history.undo", discards });
}
