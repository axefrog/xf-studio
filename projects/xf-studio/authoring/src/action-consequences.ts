import type { CollectionDraftSummary } from "./collection-actions";
import type { CollectionRequest } from "./collection-service";
import type { HistoryJumpPlan, HistoryState } from "./authoring-history";
import { ACTION_DESCRIPTORS, FILE_DESCRIPTORS } from "./studio-action-descriptors";
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
  /** Recoverable state that this action pushes out of reach. */
  discards: { kind: "recovery-draft" | "removed-preset" | "undo-entry" | "redo"; label: string }[];
  recoverableBy: "recipe.undo" | "recipe.redo" | "preset.restore" | "collection.undoOpen" | "none";
  /** True only when something recoverable would be lost for good. */
  confirm: boolean;
};
export type ConsequenceSubject = { action: StudioAction } | { file: StudioFileAction } | { request: CollectionRequest };
type State = { draft?: CollectionDraftSummary; history: HistoryState; undoLimit: number; removedLimit: number;
  /** For `history.jumpTo`: which way the jump goes. */
  jump?: HistoryJumpPlan };

export function consequenceOf(subject: ConsequenceSubject, state: State): Consequence {
  const none: Consequence = { discards: [], recoverableBy: "none", confirm: false };
  const done = (value: Omit<Consequence, "confirm">): Consequence => ({ ...value, confirm: value.discards.some(item =>
    item.kind === "recovery-draft" || item.kind === "removed-preset") });
  const draft = state.draft;
  // Opening or importing adds the current draft to a bounded queue; at capacity the oldest goes.
  const replaceDraft = () => done({ replaces: "draft", recoverableBy: "collection.undoOpen",
    discards: draft && draft.recoveryCount >= draft.recoveryLimit && draft.oldestRecoverable
      ? [{ kind: "recovery-draft", label: draft.oldestRecoverable.name }] : [] });
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
  if (action.kind === "recipe.undo") return done({ replaces: "layer-content", discards: [],
    recoverableBy: state.history.undo ? "recipe.redo" : "none" });
  if (action.kind === "recipe.redo") return done({ replaces: "layer-content", discards: [], recoverableBy: "recipe.undo" });
  // A jump is a run of Undo or Redo steps: nothing is discarded, and the steps stay reachable.
  if (action.kind === "history.jumpTo") return done({ replaces: "layer-content", discards: [],
    recoverableBy: state.jump?.direction === "redo" ? "recipe.undo" : state.jump?.direction === "undo" ? "recipe.redo" : "none" });
  if (ACTION_DESCRIPTORS[action.kind].effect !== "content") return none;
  // Every other content edit records one Undo entry; it drops Redo and, at the bound, the oldest Undo.
  const discards: Consequence["discards"] = [];
  if (state.history.redo) discards.push({ kind: "redo", label: state.history.redo.label });
  if (state.history.depth >= state.undoLimit) discards.push({ kind: "undo-entry", label: "Oldest Undo step" });
  const destructive = action.kind === "point.remove" || action.kind === "field.remove" ||
    action.kind === "layer.edit" && (action.command.kind === "remove" || action.command.kind === "reset");
  return done({ ...(destructive ? { replaces: "layer-content" as const } : {}), recoverableBy: "recipe.undo", discards });
}
