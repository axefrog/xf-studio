/** A registered layered-makeup editor publishes through one feature document and look history. */
import type { FeatureEditorHost } from "../../platform/api/editor";
import type { HistoryLabel } from "../../platform/api/history";
import { AuthoringControlEdits } from "./editing-controls";
import { AuthoringGestures } from "./editing-gestures";
import { eyeMakeupPort, RecipeActions, type EyeMakeupGestures, type EyeMakeupSpec } from "./editing-actions";
import type { EditingDocument } from "./editing-document";
import { emptyRecipe, type Recipe } from "./recipe";
import { parseFieldSelection } from "./field-selection";
import type { RecipeActionState, RecipeActionEffect } from "./recipe-actions";
import type { GlitterChoices } from "./glitter-model";
import type { LayeredMakeupRegion } from "./region";
export type MakeupPublication = { effect: RecipeActionEffect | { kind: "gesture"; layerIndex: number } | { kind: "structure" } | { kind: "restore" };
  previous?: Recipe; gestureKind?: string };
export type MakeupEditing = ReturnType<typeof createLayeredMakeupEditor>;
const clamp = (n: number, count: number) => Math.max(0, Math.min(Number.isInteger(n) ? n : 0, count - 1));
export function createLayeredMakeupEditor(host: FeatureEditorHost, feature: string, region: LayeredMakeupRegion) {
  const live = host.editing!;
  const listeners = new Set<(event: MakeupPublication) => void>();
  const publish = (event: MakeupPublication) => { for (const listener of listeners) listener(event); };
  const read = (): RecipeActionState => { const state = live.state(); return { recipe: state.part as Recipe, ...state.editor as Omit<RecipeActionState, "recipe"> }; };
  let label: HistoryLabel | undefined;
  const editing: EditingDocument = {
    get recipe() { return read().recipe; }, get active() { return read().active; }, get selected() { return read().selected; },
    get fieldSelection() { return read().fieldSelection; }, feature, get scopeId() { return live.history.id; }, get history() { return live.history; },
    checkpoint() { return live.history.checkpoint([feature], label); },
    withHistoryLabel(next, change) { const previous = label; label = next; try { return change(); } finally { label = previous; } },
    replaceRecipe(recipe, active = 0) {
      const before = read(), same = before.recipe.layers[before.active]?.id === recipe.layers[active]?.id;
      live.set(recipe, { active, selected: same ? clamp(before.selected, recipe.layers[active]?.points.length ?? 0) : 0,
        fieldSelection: parseFieldSelection(before.fieldSelection, recipe) });
      publish({ effect: { kind: "structure" }, previous: before.recipe });
    },
    publishLayer(recipe, layerIndex) { live.set(recipe, live.state().editor); publish({ effect: { kind: "immediate", layerIndex } }); },
    applyActionState(next, effect) { const { recipe, ...editor } = next; live.set(recipe, editor); publish({ effect }); },
    gestureChanged(layerIndex, gestureKind) { live.changed(); publish({ effect: { kind: "gesture", layerIndex }, gestureKind }); },
  };
  const memory = live.memory as { choices?: GlitterChoices } | undefined;
  const recipe = new RecipeActions(read, editing.applyActionState, editing, memory?.choices ?? {}, live.key,
    (index, kind) => editing.gestureChanged(index, kind), host.signal);
  const eyeMakeup = eyeMakeupPort(editing, recipe, region, undefined, live.newId);
  const spec = (kind: string) => live.action(kind) as EyeMakeupSpec;
  const provider = live.gestures as EyeMakeupGestures;
  if (!provider) throw Error(`The registered editor ${feature} needs its gesture provider.`);
  const gestures = new AuthoringGestures(editing, { applyGesture: edit => eyeMakeup.gesture(provider, edit) }, provider.label, host.signal);
  const controls = new AuthoringControlEdits(editing, action => eyeMakeup.apply(spec(action.kind), action, false).changed,
    action => spec(action.kind).label(action), host.signal);
  live.observeReplay({
    editor(previous, value) {
      const before = previous.part as Recipe | undefined, recipe = value as Recipe | undefined;
      const memory = previous.editor as Omit<RecipeActionState, "recipe">;
      const activeId = before?.layers[memory.active]?.id, active = clamp(recipe?.layers.findIndex(layer => layer.id === activeId) ?? 0, recipe?.layers.length ?? 0);
      return { active, selected: activeId === recipe?.layers[active]?.id ? clamp(memory.selected, recipe?.layers[active]?.points.length ?? 0) : 0,
        fieldSelection: parseFieldSelection(memory.fieldSelection, recipe ?? emptyRecipe()) };
    },
    restored(previous) { publish({ effect: { kind: "restore" }, previous: previous as Recipe }); },
  });
  live.onReplacing(() => {
    if (host.signal.aborted) return;
    const control = controls.snapshot(), gesture = gestures.snapshot();
    if (control) controls.commit(control.id);
    if (gesture) gestures.commit(gesture.source);
  });
  host.signal.addEventListener("abort", () => { listeners.clear(); }, { once: true });
  return { recipe, eyeMakeup, gestures, controls,
    subscribePublication(listener: (event: MakeupPublication) => void) {
      if (host.signal.aborted) throw Error("This makeup editor's context has ended.");
      listeners.add(listener); const off = () => listeners.delete(listener);
      host.signal.addEventListener("abort", off, { once: true });
      return () => { off(); host.signal.removeEventListener("abort", off); };
    } };
}
