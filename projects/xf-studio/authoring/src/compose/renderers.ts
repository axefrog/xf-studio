/**
 * The renderer composition list (feature-module platform §5, step 7): every feature renderer the scene host creates once the head
 * is ready, in draw-preparation (and draw-order band) order. Adding a feature that draws adds its `FeatureRendererFactory` here; the
 * host itself names none. Only composition roots import this list (the browser startup, study tools and tests); they hand it to the
 * viewport device.
 */
import type { FeatureRendererFactory } from "../platform/api/scene";
import type { LayeredSurfaceRenderer } from "../engines/layered-makeup/render/makeup-stack";
import { EYE_MAKEUP_RENDERER } from "../features/eye-makeup/render";

export const STUDIO_RENDERERS: readonly FeatureRendererFactory[] = Object.freeze([EYE_MAKEUP_RENDERER]);

/**
 * The composed renderers that draw a layered-makeup surface, by feature (UI-76): the root wires a preview device and the on-head editor
 * to the one for the live feature (the feature the authoring document edits), and names no feature itself. A second layered feature
 * adds its renderer here and in `STUDIO_RENDERERS`.
 */
export const STUDIO_LAYERED_SURFACES: ReadonlyMap<string, FeatureRendererFactory<LayeredSurfaceRenderer>> =
  new Map<string, FeatureRendererFactory<LayeredSurfaceRenderer>>([[EYE_MAKEUP_RENDERER.feature, EYE_MAKEUP_RENDERER]]);
