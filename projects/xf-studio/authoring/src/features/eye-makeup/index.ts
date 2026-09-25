/**
 * Eye makeup, feature module #1 (feature-module platform §1). Migration step 1 registers its
 * existing action table as-is: the recipe actions and the layer-structure actions, with their
 * descriptors and Undo policies from `studio-action-descriptors.ts`. The eye-makeup files stay
 * where they are until step 5 moves them here and into `engines/layered-makeup`; until then this
 * module imports them from `src/` (recorded in the design's step 1 status).
 */
import { actionTable, featureId, type FeatureModule } from "../../platform/api";
import type { LayerAction } from "../../editor-actions";
import type { RecipeAction } from "../../recipe-actions";
import { ACTION_DESCRIPTORS, type ActionScope } from "../../studio-action-descriptors";

export const EYE_MAKEUP_ID = featureId("eye-makeup");
/** Every eye-makeup action: recipe edits and layer structure. Kinds are grandfathered, unqualified. */
export type EyeMakeupAction = RecipeAction | LayerAction;

/** Registration order is the catalogue order the descriptor table has always had. */
const KINDS: Record<EyeMakeupAction["kind"], true> = {
  "layer.select": true, "point.select": true, "point.remove": true, "path.edit": true, "field.select": true,
  "field.add": true, "field.remove": true, "field.clear": true, "field.setReach": true, "pigment.edit": true,
  "softness.edit": true, "layer.setColor": true, "layer.setOpacity": true, "layer.setSymmetry": true,
  "layer.setFinish": true, "layer.useGameOptics": true, "layer.setShift": true, "glitter.selectModel": true,
  "glitter.setClassic": true, "glitter.setIrregular": true, "glitter.setDirect": true, "point.move": true,
  "point.insert": true, "point.setTangent": true, "shape.transform": true, "field.setOrigin": true,
  "field.setVector": true, "layer.edit": true, "layer.setEnabled": true,
};

export const EYE_MAKEUP: FeatureModule<EyeMakeupAction, ActionScope, typeof EYE_MAKEUP_ID> = Object.freeze({
  owner: "feature", id: EYE_MAKEUP_ID, api: 1, label: "Eye makeup", stage: "stable",
  actions: actionTable<EyeMakeupAction, ActionScope>(ACTION_DESCRIPTORS, KINDS),
});
