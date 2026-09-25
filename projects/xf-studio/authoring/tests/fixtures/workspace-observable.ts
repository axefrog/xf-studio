/**
 * What a person can observe after a workspace is restored, read only through interfaces that
 * exist before and after the step-2 migration: `loadWorkspace`, `encodeWorkspaceAt` and the
 * collection command boundary. The golden `tests/golden/workspace-v1-observable.json` was
 * captured with this extractor from the pre-migration code; the migrated code must match it.
 */
import { createHash } from "node:crypto";
import { CollectionActions } from "../../src/collection-actions";
import type { EditorSnapshot } from "../../src/collection-session";
import { encodeWorkspaceAt } from "../../src/workspace-budget";
import { loadWorkspace, type WorkspaceState } from "../../src/workspace-state";
import { STUDIO_DOCUMENTS } from "../../src/compose/studio-registry";
import { historyRecipes } from "./looks";

/** Canonical JSON (object keys sorted): key order is not observable, so it is not compared. */
export const canonical = (value: unknown) => JSON.stringify(value, (_key, item: unknown) => item && typeof item === "object" &&
  !Array.isArray(item) ? Object.fromEntries(Object.keys(item as object).sort().map(key => [key, (item as Record<string, unknown>)[key]])) : item);
export const digest = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");

export function restore(stored: unknown) {
  const text = typeof stored === "string" ? stored : JSON.stringify(stored);
  return loadWorkspace({ getItem: key => key === "xfas.workspace.v1" ? text : null }, false, STUDIO_DOCUMENTS);
}

/** Every observable fact of one restored workspace, as plain data. */
export function observe(state: WorkspaceState) {
  // Undo histories are compared as the whole recipes each step restores (the look history keeps them as chunks).
  const top = { recipe: state.recipe, active: state.active, selected: state.selected, history: historyRecipes(state.history),
    historyTrimmed: state.historyTrimmed ?? false, fieldSelection: state.fieldSelection, glitterChoices: state.glitterChoices,
    uvView: state.uvView, preview: state.preview, library: state.library, uiPreferences: state.uiPreferences,
    previewSetup: state.previewSetup ?? null, savedV: state.savedV ?? null };
  if (!state.collections) return { top, collection: null };
  let shown: EditorSnapshot | undefined;
  const actions = new CollectionActions(STUDIO_DOCUMENTS, structuredClone(state.collections), () => structuredClone(shown!),
    editor => { shown = structuredClone(editor); });
  // The restored editor is the selected preset's memory, which parseWorkspace copied to the top level.
  shown = { recipe: state.recipe, active: state.active, selected: state.selected, fieldSelection: state.fieldSelection,
    history: state.history, ...(state.historyTrimmed ? { historyTrimmed: true } : {}) };
  const editor = () => ({ ...structuredClone(shown!), history: historyRecipes(shown!.history),
    historyTrimmed: shown!.historyTrimmed ?? false });
  const presets = (label: string) => {
    const summary = actions.summary();
    return { label, summary, presets: summary.presets.map(preset => {
      actions.dispatch({ kind: "preset.select", id: preset.id });
      return { id: preset.id, editor: editor() };
    }) };
  };
  const drafts = [presets("current")];
  const restored: unknown[] = [];
  while (actions.summary().removed.length) {
    actions.dispatch({ kind: "preset.edit", command: { kind: "restore" } });
    restored.push({ summary: actions.summary(), editor: editor() });
  }
  const recovery = actions.summary().recoveryCount;
  for (let i = 0; i < recovery; i++) {
    actions.dispatch({ kind: "collection.undoOpen" });
    drafts.push(presets(`recovery ${i + 1}`));
  }
  return { top, collection: { drafts, restored } };
}

/** The observable after a restore, then after each budget level's stored form is restored again. */
export function observeRoundTrips(stored: unknown) {
  const loaded = restore(stored);
  if (!loaded.writable) throw Error(loaded.error);
  const first = observe(loaded.state);
  const levels = [0, 1, 2, 3].map(level => {
    const again = restore(encodeWorkspaceAt(loaded.state, level, STUDIO_DOCUMENTS).encoded);
    if (!again.writable) throw Error(again.error);
    return observe(again.state);
  });
  return { warning: loaded.warning ?? null, first, levels };
}
