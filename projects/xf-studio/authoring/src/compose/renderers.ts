/**
 * The renderer composition list (feature-module platform §5, step 7): every feature renderer the scene host creates once the head
 * is ready, in draw-preparation order. Adding a feature that draws adds its `FeatureRendererFactory` here; the host itself names none.
 * Only composition roots import this list (the browser startup, study tools and tests); they hand it to the viewport device.
 */
import type { FeatureRendererFactory } from "../platform/api/scene";
import { EYE_MAKEUP_RENDERER } from "../features/eye-makeup/render";

export const STUDIO_RENDERERS: readonly FeatureRendererFactory[] = Object.freeze([EYE_MAKEUP_RENDERER]);
