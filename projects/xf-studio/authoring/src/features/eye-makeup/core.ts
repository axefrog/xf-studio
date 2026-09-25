/**
 * Eye makeup's pure action behaviour (feature-module platform §1): capability and apply over
 * the recipe part and the editor state. They wrap the existing pure functions
 * (`recipeActionCapability`/`applyRecipeAction`, `layerCapability`/`applyLayerAction`), so the
 * application, form controls and tests all run the same rules.
 */
import type { Capability, FeatureResult, FeatureState } from "../../platform/api";
import { parseFieldSelection, type FieldSelection } from "../../field-selection";
import type { GlitterChoices, LayerChoices } from "../../glitter-model";
import { applyLayerAction, layerCapability, type LayerAction } from "../../editor-actions";
import { applyRecipeAction, recipeActionCapability, type RecipeAction, type RecipeActionEffect } from "../../recipe-actions";
import type { Recipe } from "../../recipe";

export type EyeMakeupAction = RecipeAction | LayerAction;
/**
 * The editor state actions read: the look's editor memory plus its layers' remembered Glitter
 * and Colour-shift settings (keyed by layer ID; the host projects them from the feature memory).
 */
export type EyeMakeupEditorState = { active: number; selected: number; fieldSelection: FieldSelection;
  choices: Readonly<Record<string, LayerChoices>> };
export type EyeMakeupState = FeatureState<Recipe, EyeMakeupEditorState>;
/**
 * What the preview does with a result: a recipe action's scheduled, immediate or selection-only
 * effect; `structure` when the layer stack changed (resources are reconciled against the
 * previous recipe); `none` when nothing changed.
 */
export type EyeMakeupEffect = RecipeActionEffect | { kind: "structure" } | { kind: "none" };
export type EyeMakeupResult = FeatureResult<Recipe, EyeMakeupEditorState, EyeMakeupEffect>;

const isLayerAction = (action: EyeMakeupAction): action is LayerAction =>
  action.kind === "layer.edit" || action.kind === "layer.setEnabled";
/** Choices scope used inside the pure call; the recipe functions key memory `<scope>/<layer>`. */
const SCOPE = "look";

export function eyeMakeupCapability(state: EyeMakeupState, action: EyeMakeupAction): Capability {
  if (isLayerAction(action)) return layerCapability(state.part, action);
  const { active, selected, fieldSelection } = state.editor;
  return recipeActionCapability({ recipe: state.part, active, selected, fieldSelection }, action);
}

export function applyEyeMakeup(state: EyeMakeupState, action: EyeMakeupAction): EyeMakeupResult {
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
