/**
 * Why a shown character detail is drawn only in part, as a code. Renderer adapters report these limits as
 * codes, and the presentation owns their wording (studio-ui/panels/preview.ts). This covers limits only: a detail
 * that fails to load is still reported with a sentence the character-detail loader writes itself
 * (`problems` in character-detail-loader.ts).
 * - `head-shape`: an installed mod changes the head's shape; the preview draws that head, but eye makeup
 *   is still placed on the original shape.
 * - `skin-glow`: the skin has a glowing (emissive) part the preview does not draw yet.
 * - `eye-design`: the eye colour is a layered (`multilayered.mt`) design the preview does not draw yet; the default
 *   eye is shown in its place, with the chosen eye's wetness.
 * - `layered-material`: another part made of layered materials is not drawn yet.
 */
export const DETAIL_LIMITS = ["head-shape", "skin-glow", "eye-design", "layered-material"] as const;
export type DetailLimit = typeof DETAIL_LIMITS[number];
