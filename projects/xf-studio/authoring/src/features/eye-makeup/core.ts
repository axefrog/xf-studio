/**
 * Eye makeup's pure action behaviour (feature-module platform §1): capability and apply over
 * the recipe part and the editor state. They wrap the existing pure functions
 * (`recipeActionCapability`/`applyRecipeAction`, `layerCapability`/`applyLayerAction`), so the
 * application, form controls and tests all run the same rules.
 *
 * Apply is deterministic: an action that creates an item (a warp control, a layer) carries the
 * new item's ID, which its host fills in with `assignEyeMakeupIds` before applying it, so the
 * same state and action always give the same result (replay; migration step 4).
 */
import type { Capability } from "../../platform/api";
import { parseFieldSelection } from "../../engines/layered-makeup/field-selection";
import type { GlitterChoices, LayerChoices } from "../../engines/layered-makeup/glitter-model";
import { applyLayerAction, layerCapability, type LayerAction } from "../../editor-actions";
import { applyRecipeAction, recipeActionCapability } from "../../engines/layered-makeup/recipe-actions";
import type { EyeMakeupAction, EyeMakeupResult, EyeMakeupState } from "../../eye-makeup-model";

export type { EyeMakeupAction, EyeMakeupEditorState, EyeMakeupEffect, EyeMakeupResult, EyeMakeupState } from "../../eye-makeup-model";

const isLayerAction = (action: EyeMakeupAction): action is LayerAction =>
  action.kind === "layer.edit" || action.kind === "layer.setEnabled";
/** Choices scope used inside the pure call; the recipe functions key memory `<scope>/<layer>`. */
const SCOPE = "look";

export function eyeMakeupCapability(state: EyeMakeupState, action: EyeMakeupAction): Capability {
  if (isLayerAction(action)) return layerCapability(state.part, action);
  const { active, selected, fieldSelection } = state.editor;
  return recipeActionCapability({ recipe: state.part, active, selected, fieldSelection }, action);
}

/** The action with the IDs of the items it creates filled in from the host's ID source (never overwritten). */
export function assignEyeMakeupIds(action: EyeMakeupAction, newId: () => string): EyeMakeupAction {
  if (action.kind === "field.add" && !action.fieldId) return { ...action, fieldId: newId() };
  if (action.kind === "layer.edit" && (action.command.kind === "add" || action.command.kind === "duplicate") && !action.command.newId)
    return { ...action, command: { ...action.command, newId: newId() } };
  return action;
}
/** Whether an action that creates an item lacks its ID (apply then refuses: it never invents one). */
function lacksId(action: EyeMakeupAction) {
  return action.kind === "field.add" ? !action.fieldId :
    action.kind === "layer.edit" && (action.command.kind === "add" || action.command.kind === "duplicate") && !action.command.newId;
}

export function applyEyeMakeup(state: EyeMakeupState, action: EyeMakeupAction): EyeMakeupResult {
  if (lacksId(action)) throw Error(`${action.kind} needs the new item's ID from its host (assignEyeMakeupIds).`);
  const editor = state.editor;
  if (isLayerAction(action)) {
    const next = applyLayerAction(state.part, state.part.layers[editor.active]?.id, action);
    if (!next.structure) return { part: next.recipe, editor, changed: true,
      effect: { kind: "immediate", layerIndex: next.changed } };
    // The same selection rule AuthoringDocument.replaceRecipe applies after a stack edit.
    const recipe = next.recipe, active = clampIndex(next.active, recipe.layers.length);
    const sameLayer = state.part.layers[editor.active]?.id === recipe.layers[active]?.id;
    return { part: recipe, changed: true, effect: { kind: "structure" }, editor: { ...editor, active,
      selected: sameLayer ? clampIndex(editor.selected, recipe.layers[active]?.points.length ?? 0) : 0,
      fieldSelection: parseFieldSelection(editor.fieldSelection, recipe) } };
  }
  const choices: GlitterChoices = {};
  for (const [layerId, remembered] of Object.entries(editor.choices)) choices[`${SCOPE}/${layerId}`] = remembered;
  const result = applyRecipeAction({ recipe: state.part, active: editor.active, selected: editor.selected,
    fieldSelection: editor.fieldSelection }, action, choices, SCOPE);
  if (!result.changed) return { part: state.part, editor, changed: false, effect: { kind: "none" } };
  const nextChoices: Record<string, LayerChoices> = {};
  for (const [key, remembered] of Object.entries(result.choices))
    if (key.startsWith(`${SCOPE}/`)) nextChoices[key.slice(SCOPE.length + 1)] = remembered;
  return { part: result.state.recipe, changed: true, effect: result.effect,
    editor: { active: result.state.active, selected: result.state.selected, fieldSelection: result.state.fieldSelection,
      choices: nextChoices } };
}

function clampIndex(value: number, length: number) {
  return length <= 0 ? 0 : Math.max(0, Math.min(Number.isInteger(value) ? value : 0, length - 1));
}
