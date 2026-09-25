/**
 * Eye makeup, feature module #1 (feature-module platform §1). It registers its part codec
 * (`xfs/eye-makeup-part-2`, the in-memory recipe; part-1 still reads), its editor-memory codecs
 * and its action table: the existing descriptors and Undo policies from `studio-action-descriptors.ts` with a pure
 * capability and apply (migration step 2). The eye-makeup files stay where they are until
 * step 5 moves them here and into `engines/layered-makeup`; until then this module imports
 * them from `src/` (recorded in the design's step 1 status).
 */
import { featureActionTable, featureId, type FeatureModule } from "../../platform/api";
import type { Recipe } from "../../recipe";
import { applyRecipeGesture, type GestureEdit } from "../../recipe-actions";
import { EYE_MAKEUP_FEATURE } from "../../recipe-schema";
import { ACTION_DESCRIPTORS, GESTURE_DESCRIPTORS, type ActionScope } from "../../studio-action-descriptors";
import { applyEyeMakeup, assignEyeMakeupIds, eyeMakeupCapability, type EyeMakeupAction, type EyeMakeupEditorState,
  type EyeMakeupEffect } from "./core";
import { eyeMakeupEditor, eyeMakeupMemory, eyeMakeupPart } from "./part";

export const EYE_MAKEUP_ID = featureId(EYE_MAKEUP_FEATURE);
export type { EyeMakeupAction, EyeMakeupEditorState, EyeMakeupEffect, EyeMakeupResult, EyeMakeupState } from "./core";
export { assignEyeMakeupIds } from "./core";
export type { EyeMakeupEditor, EyeMakeupMemory } from "./part";
export { EYE_MAKEUP_PART_1, EYE_MAKEUP_PART_2, RECIPE_SCHEMAS, eyeMakeupPartCodec } from "./part";

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

/** What one gesture frame changed: the layer the preview reschedules and the edit's kind. */
export type EyeMakeupGestureResult = { layerIndex: number; kind: GestureEdit["kind"] };

export const EYE_MAKEUP: FeatureModule<EyeMakeupAction, ActionScope, typeof EYE_MAKEUP_ID, Recipe, EyeMakeupEditorState,
  EyeMakeupEffect, GestureEdit, EyeMakeupGestureResult> = Object.freeze({
  owner: "feature", id: EYE_MAKEUP_ID, api: 1, label: "Eye makeup", stage: "stable",
  part: eyeMakeupPart, editor: eyeMakeupEditor, memory: eyeMakeupMemory,
  // Gesture proposals are catalogued with the gestures; the platform owns the session's Undo transaction.
  gestures: { apply: applyRecipeGesture, descriptors: GESTURE_DESCRIPTORS },
  actions: featureActionTable<Recipe, EyeMakeupEditorState, EyeMakeupAction, ActionScope, EyeMakeupEffect>(
    ACTION_DESCRIPTORS, KINDS, { capability: eyeMakeupCapability, apply: applyEyeMakeup, assignIds: assignEyeMakeupIds }),
});
