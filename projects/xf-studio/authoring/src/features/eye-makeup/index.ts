/**
 * Eye makeup, feature module #1 (feature-module platform §1). It registers its part codec
 * (`xfs/eye-makeup-part-2`, the in-memory recipe; part-1 still reads), its editor-memory codecs,
 * its action table (the descriptors and Undo policies of `eye-makeup-descriptors.ts` with a pure
 * capability and apply) and its gestures, all over the layered-makeup engine with eye makeup's
 * region (`region.ts`). Its core imports only the platform API, the engine, pure helpers, its own
 * folder and the legacy modules the boundary test lists with their removal steps (CORE-77).
 */
import { featureActionTable, featureId, type FeatureModule } from "../../platform/api";
import type { Recipe } from "../../engines/layered-makeup/recipe";
import { applyRecipeGesture, type GestureEdit } from "../../engines/layered-makeup/recipe-actions";
import { EYE_MAKEUP_REGION } from "./region";
import { EYE_MAKEUP_FEATURE } from "../../recipe-schema";
import { gestureHistoryLabel, historyLabel } from "../../history-labels";
import { EYE_MAKEUP_DESCRIPTORS, EYE_MAKEUP_GESTURE_DESCRIPTORS, type EyeMakeupScope } from "../../eye-makeup-descriptors";
import { applyEyeMakeup, assignEyeMakeupIds, eyeMakeupCapability, type EyeMakeupAction, type EyeMakeupEditorState,
  type EyeMakeupEffect } from "./core";
import { eyeMakeupEditor, eyeMakeupMemory, eyeMakeupPart } from "./part";
import { EYE_MAKEUP_LIMITS, EYE_MAKEUP_UNITS, eyeMakeupConsequence } from "./limits";
import { EYE_MAKEUP_EXPORT } from "./export-info";

export const EYE_MAKEUP_ID = featureId(EYE_MAKEUP_FEATURE);
export type { EyeMakeupAction, EyeMakeupEditorState, EyeMakeupEffect, EyeMakeupResult, EyeMakeupState } from "./core";
export { assignEyeMakeupIds } from "./core";
export type { EyeMakeupEditor, EyeMakeupMemory } from "./part";
export { EYE_MAKEUP_PART_1, EYE_MAKEUP_PART_2, RECIPE_SCHEMAS, eyeMakeupPartCodec } from "./part";
export { EYE_MAKEUP_REGION } from "./region";
export { EYE_MAKEUP_EXPORT, EYE_MAKEUP_EXPORTER_ID, EYE_PLATE_PREREQUISITE } from "./export-info";

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

export const EYE_MAKEUP: FeatureModule<EyeMakeupAction, EyeMakeupScope, typeof EYE_MAKEUP_ID, Recipe, EyeMakeupEditorState,
  EyeMakeupEffect, GestureEdit, EyeMakeupGestureResult> = Object.freeze({
  owner: "feature", id: EYE_MAKEUP_ID, api: 1, label: "Eye makeup", stage: "stable",
  part: eyeMakeupPart, editor: eyeMakeupEditor, memory: eyeMakeupMemory, exports: EYE_MAKEUP_EXPORT,
  // Gesture proposals are catalogued with the gestures; the platform owns the session's Undo transaction.
  gestures: { apply: (recipe: Recipe, edit: GestureEdit) => applyRecipeGesture(recipe, edit, EYE_MAKEUP_REGION.models),
    label: gestureHistoryLabel, descriptors: EYE_MAKEUP_GESTURE_DESCRIPTORS },
  actions: featureActionTable<Recipe, EyeMakeupEditorState, EyeMakeupAction, EyeMakeupScope, EyeMakeupEffect>(
    EYE_MAKEUP_DESCRIPTORS, KINDS, { capability: eyeMakeupCapability, apply: applyEyeMakeup, assignIds: assignEyeMakeupIds,
      label: historyLabel, units: EYE_MAKEUP_UNITS, limits: EYE_MAKEUP_LIMITS, consequence: eyeMakeupConsequence }),
});
