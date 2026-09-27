/**
 * The renderer composition list (feature-module platform §5, step 7): every feature renderer the scene host creates once the head
 * is ready, in draw-preparation (and draw-order band) order. Adding a feature that draws adds its `FeatureRendererFactory` here; the
 * host itself names none. Only composition roots import this list (the browser startup, study tools and tests); they hand it to the
 * viewport device.
 */
import type { FeatureRendererFactory } from "../platform/api/scene";
import type { LayeredSurfaceRenderer } from "../engines/layered-makeup/render/makeup-stack";
import { EYE_MAKEUP_RENDERER } from "../features/eye-makeup/render";
import { EXPRESSIONS_ID, expressionPose } from "../features/expressions";

export const STUDIO_RENDERERS: readonly FeatureRendererFactory[] = Object.freeze([EYE_MAKEUP_RENDERER]);

/**
 * The composed renderers that draw a layered-makeup surface, by feature (UI-76): the root wires a preview device and the on-head editor
 * to the one for the live feature (the feature the authoring document edits), and names no feature itself. A second layered feature
 * adds its renderer here and in `STUDIO_RENDERERS`.
 */
export const STUDIO_LAYERED_SURFACES: ReadonlyMap<string, FeatureRendererFactory<LayeredSurfaceRenderer>> =
  new Map<string, FeatureRendererFactory<LayeredSurfaceRenderer>>([[EYE_MAKEUP_RENDERER.feature, EYE_MAKEUP_RENDERER]]);

/**
 * The features that pose V's face (research/animation/expression-editor-design.md §4): each reads the pose its part holds, and the
 * platform's facial preview solves them together on the head. The root names none of them.
 */
export const STUDIO_FACE_POSES: readonly { readonly feature: string; pose(part: unknown): Readonly<Record<string, number>> | undefined }[] =
  Object.freeze([{ feature: EXPRESSIONS_ID, pose: expressionPose }]);
