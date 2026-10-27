import type { FeatureEditHost } from "../../platform/api/editor";
import type { Recipe } from "./recipe";
import type { RecipeActionEffect, RecipeActionState } from "./recipe-actions";
import type { HistoryLabel } from "../../platform/api/history";
export interface EditingDocument {
  readonly recipe: Recipe;
  readonly active: number;
  readonly selected: number;
  readonly fieldSelection: RecipeActionState["fieldSelection"];
  readonly feature: string;
  readonly scopeId: string;
  readonly history: FeatureEditHost["history"];
  checkpoint(recipe?: Recipe): unknown;
  withHistoryLabel<T>(label: HistoryLabel, change: () => T): T;
  replaceRecipe(recipe: Recipe, active?: number): void;
  publishLayer(recipe: Recipe, layerIndex: number): void;
  applyActionState(state: RecipeActionState, effect: RecipeActionEffect): void;
  gestureChanged(layerIndex: number, kind: string): void;
}
