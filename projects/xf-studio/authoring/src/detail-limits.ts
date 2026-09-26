/**
 * Why a shown character detail is drawn only in part, as a code. Renderer adapters report these limits as
 * codes, and the presentation owns their wording (studio-ui/panels/preview.ts). This covers limits only: a detail
 * that fails to load is still reported with a sentence the character-detail loader writes itself
 * (`problems` in character-detail-loader.ts).
 * - `head-shape`: an installed mod changes the head's shape; the preview draws that head, but eye makeup
 *   is still placed on the original shape.
 * - `skin-glow`: the skin has a glowing (emissive) part the preview does not draw yet.
 * - `eye-design`: the eye colour is a layered (`multilayered.mt`) design the preview could not draw (its layer setup was unreadable, or
 *   its layers could not be baked on this GPU); the default eye is shown in its place, with the chosen eye's wetness.
 * - `layered-material`: another part made of layered materials (a piercing, or a layered part of hair or another detail) could not be
 *   drawn, for the same reasons; it is left out.
 * - `layered-mask`: a layered part's mask could not be read, so only its bottom layer is drawn (its colour and finish only).
 * - `layered-base`: a layered part's bottom layer template could not be read, so a neutral grey matte stands in for it where no
 *   other layer covers (PREV-76).
 * - `decal-template`: a face detail uses a decal material (a `mesh_decal` family member such as the emissive or parallax
 *   decal) the preview does not draw yet; that part is left out.
 * - `rigid-part`: a part whose exported mesh has no skin (a framework's linked ring) is drawn where the export placed it and does not
 *   follow the head's idle movement. The component binds to the entity's `root`, not to a head bone, so the data names no bone to
 *   follow [resource]; how the engine moves such a part is unread [hypothesis] (knowledge/head-cc-rendering.md).
 * - `part-unread`: the host couldn't prepare some of a shown slot's parts (their shape or an input they need couldn't be read or
 *   exported), so those parts are left out and the others drawn. The host sets it on the record's slot; the record's notes and the
 *   diagnostics window's `character/prepared` event say which parts and why (PIPE-84).
 */
export const DETAIL_LIMITS = ["head-shape", "skin-glow", "eye-design", "layered-material", "layered-mask", "layered-base", "decal-template", "rigid-part",
  "part-unread"] as const;
export type DetailLimit = typeof DETAIL_LIMITS[number];

/**
 * Why the V's details are not shown at all, as a code the presentation words (beside the plain `message` a host sends).
 * - `version-skew`: the page and the preview host are different builds (XF Studio was updated while it ran), so the host's records or
 *   answers are of a version the page doesn't read, or the reverse. A restart fixes it.
 */
export const DETAIL_NOTICES = ["version-skew"] as const;
export type DetailNotice = typeof DETAIL_NOTICES[number];

/** Thrown by the character-detail device when the host and the page disagree on a version (`version-skew`). */
export class DetailVersionSkewError extends Error {
  readonly notice: DetailNotice = "version-skew";
  constructor(detail: string) { super(`The preview host and this page are different versions: ${detail}`); }
}

/** The limit codes of each shown slot, as the renderer reports them after the details were placed (PREV-74). */
export type SlotLimits = readonly { slot: string; limits: readonly DetailLimit[] }[];
/** `slots` with each shown slot's limit codes replaced by `update`'s (a slot `update` doesn't name, or not shown, is kept as it is). */
export function withSlotLimits<T extends { slot: string; state: string; limits?: DetailLimit[] }>(slots: readonly T[], update: SlotLimits): T[] {
  return slots.map(slot => {
    const next = update.find(entry => entry.slot === slot.slot);
    if (!next || slot.state !== "shown") return slot;
    const { limits: _old, ...rest } = slot;
    return (next.limits.length ? { ...rest, limits: [...next.limits] } : rest) as T;
  });
}
