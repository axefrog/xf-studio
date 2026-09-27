/**
 * Expressions, feature module #2 (research/animation/expression-editor-design.md, phase 1): a look's static face as a sparse vector
 * of the player rig's named main-pose controls. It registers its part (`xfs/expression-part-1`), its editor memory and its action
 * table with a pure capability and apply over the facial-rig engine's name rules. Posing the head is the platform's facial preview,
 * which the composition feeds with this part's vector (compose/renderers.ts `STUDIO_FACE_POSES`); export comes in phase 3.
 */
import { featureActionTable, featureId, type FeatureModule } from "../../platform/api";
import { applyExpression, EXPRESSION_DESCRIPTORS, expressionCapability, expressionLabel, type ExpressionAction, type ExpressionEffect,
  type ExpressionScope } from "./core";
import { expressionEditor, expressionPart, type ExpressionEditor, type ExpressionPart } from "./part";

export const EXPRESSIONS_ID = featureId("expressions");
export type { ExpressionAction, ExpressionEffect, ExpressionScope, ExpressionState, ExpressionResult } from "./core";
export { pairLinked } from "./core";
export type { ExpressionEditor, ExpressionOrigin, ExpressionPart } from "./part";
export { EXPRESSION_PART_1, expressionPart } from "./part";

/** Registration order is the catalogue order. */
const KINDS: Record<ExpressionAction["kind"], true> = {
  "expression.setControl": true, "expression.linkPair": true, "expression.mirror": true, "expression.reset": true,
  "expression.startFrom": true, "expression.setLabel": true,
};

export const EXPRESSIONS: FeatureModule<ExpressionAction, ExpressionScope, typeof EXPRESSIONS_ID, ExpressionPart, ExpressionEditor,
  ExpressionEffect> = Object.freeze({
  owner: "feature", id: EXPRESSIONS_ID, api: 1, label: "Expressions", stage: "preview",
  part: expressionPart, editor: expressionEditor as never,
  actions: featureActionTable<ExpressionPart, ExpressionEditor, ExpressionAction, ExpressionScope, ExpressionEffect>(EXPRESSION_DESCRIPTORS, KINDS, {
    capability: expressionCapability, apply: applyExpression, label: expressionLabel,
    units: { "expression.setControl": { value: "fraction" }, "expression.setLabel": { label: "characters" } } }),
});

/** The vector the platform's facial preview holds for a look's expressions part (undefined: nothing to hold). */
export function expressionPose(part: unknown): Readonly<Record<string, number>> | undefined {
  const controls = (part as ExpressionPart | undefined)?.controls;
  return controls && Object.keys(controls).length ? controls : undefined;
}
export { EXPRESSIONS_MODULE } from "./module";
