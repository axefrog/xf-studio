/**
 * Eye makeup's action and state types: what its pure capability and apply read and produce
 * (feature-module platform §1). The feature module (`features/eye-makeup`) registers behaviour
 * over them; the live document's port and the application use them without importing the
 * feature or the composition. Types only; step 5 moves this file into `features/eye-makeup`.
 */
import type { FeatureResult, FeatureState } from "./platform/api";
import type { FieldSelection } from "./engines/layered-makeup/field-selection";
import type { LayerChoices } from "./engines/layered-makeup/glitter-model";
import type { LayerAction } from "./engines/layered-makeup/layer-stack";
import type { RecipeAction, RecipeActionEffect } from "./engines/layered-makeup/recipe-actions";
import type { Recipe } from "./engines/layered-makeup/recipe";

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
