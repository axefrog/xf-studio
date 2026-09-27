/**
 * The face's control vocabulary (research/animation/expression-editor-design.md §3.2): read from the player's own face skeleton
 * (`trackNames`, `referenceTracks`) and facial setup (its track mapping: envelopes, main poses, lipsync overrides, wrinkles), never
 * hard-coded. The main-pose block is whatever the setup's mapping says it is; everything this module derives from it (drawer groups,
 * the left/right mirror map, friendly labels) is computed from the control names, so another rig or a future game version with other
 * names still gets a working drawer (unknown names fall back to their raw name in an "Other" group).
 *
 * Pure: no Three, no host globals. Shared by the expressions feature, the facial preview and the host.
 */

/** The facial setup's track mapping (`info.tracksMapping`): how many tracks of each block follow the envelopes, in `trackNames` order. */
export type TracksMapping = { readonly numEnvelopes: number; readonly numMainPoses: number; readonly numLipsyncOverrides?: number;
  readonly numWrinkles?: number };

export type ControlGroupId = "brows" | "lids" | "gaze" | "nose" | "cheeks" | "mouth" | "jaw" | "neck" | "ears" | "advanced" | "other";
/** Drawer order and the words a person reads. */
export const CONTROL_GROUPS: readonly { readonly id: ControlGroupId; readonly label: string }[] = Object.freeze([
  { id: "brows", label: "Brows" }, { id: "lids", label: "Eyes and lids" }, { id: "gaze", label: "Gaze" },
  { id: "nose", label: "Nose" }, { id: "cheeks", label: "Cheeks" }, { id: "mouth", label: "Mouth and lips" },
  { id: "jaw", label: "Jaw" }, { id: "neck", label: "Neck and throat" }, { id: "ears", label: "Ears" },
  { id: "advanced", label: "Advanced" }, { id: "other", label: "Other" },
]);

export type ControlInfo = {
  /** The track name the game's clips key (`eye_l_brows_raise_in`): the control's identity, in parts and exports. */
  readonly name: string;
  /** Its index in the rig's `trackNames`. */
  readonly track: number;
  readonly group: ControlGroupId;
  /** "Inner brow raise", without the side (a direction word such as "Jaw shift left" stays). */
  readonly label: string;
  /** The full label a person reads: "Inner brow raise, left". */
  readonly text: string;
  readonly side: "left" | "right" | null;
  /** The control on the other side (`eye_r_brows_raise_in`), when the rig has it. */
  readonly partner: string | null;
  /** The pair's key (`eye_brows_raise_in`), shared by both sides; null without a partner. */
  readonly pair: string | null;
  /** A direction pair (turn left or right, gaze in or out): the sides are opposites, not mirror images, so they start unlinked. */
  readonly direction: boolean;
  /** A plain note where the preview can't show the control (pupils, tongue). */
  readonly note?: string;
};

export type FacialVocabulary = {
  /** The skeleton and facial setup it was read from (depot file names), recorded with every solved pose. */
  readonly rig: string;
  readonly setup: string;
  /** Every track of the rig, in order, and its reference value (envelopes and override weights rest at 1, main poses at 0). */
  readonly tracks: readonly string[];
  readonly reference: readonly number[];
  /** The main-pose block: `tracks[start]` to `tracks[start + count - 1]`. */
  readonly main: { readonly start: number; readonly count: number };
  /** The main-pose controls, in track order. */
  readonly controls: readonly ControlInfo[];
};

const SIDE_TOKENS: Readonly<Record<string, "left" | "right">> = { l: "left", r: "right" };

/**
 * The mirrored control name: every standalone `l`/`r` token between underscores swapped (`eye_l_brows_lower` ↔ `eye_r_brows_lower`,
 * `jaw_mid_shift_l` ↔ `jaw_mid_shift_r`); a centre control (`jaw_mid_open`) mirrors to itself. An involution by construction.
 */
export function mirrorName(name: string): string {
  return name.split("_").map(token => token === "l" ? "r" : token === "r" ? "l" : token).join("_");
}
/** The side token of a control (the first standalone `l`/`r`), or null for a centre control. */
export function controlSide(name: string): "left" | "right" | null {
  for (const token of name.split("_")) if (SIDE_TOKENS[token]) return SIDE_TOKENS[token]!;
  return null;
}
/** A left/right pair's shared key: the name without its side tokens (`eye_brows_raise_in`); null for a centre control. */
export function pairKey(name: string): string | null {
  const tokens = name.split("_");
  return tokens.some(token => token === "l" || token === "r") ? tokens.filter(token => token !== "l" && token !== "r").join("_") : null;
}
/**
 * Whether a pair's sides are opposite directions rather than mirror images: the side is the control's last word (`jaw_mid_shift_l`,
 * `face_gravity_r`, `tongue_mid_tip_l`), or the control turns, tilts or aims (`neck_l_turn`, `head_neck_l_tilt`, `eye_l_dir_in`).
 * Linking such a pair would cancel or cross the motion, so it starts unlinked (a design choice).
 */
export function isDirectionPair(name: string): boolean {
  const tokens = name.split("_");
  return tokens.at(-1) === "l" || tokens.at(-1) === "r" || /_dir_|_turn$|_tilt$/.test(name);
}

/**
 * Neck and head turn and tilt controls: they deform neck and jaw-line skin for a head motion the body skeleton drives, and never turn
 * or tilt the head themselves (research/animation/natural-expressions.md §3.2), so a still expression has no use for them.
 */
export const isHeadMotionCorrective = (name: string) => /^(?:head_)?neck_(?:[lr]_)?(?:up_|dn_)?(?:turn|tilt)$|^head_neck_/.test(name);

/** The drawer group of a control, by its name's words. The tongue, cutscene, sculpt and head-motion correctives sit in Advanced. */
export function controlGroup(name: string): ControlGroupId {
  if (/^tongue_|_sticky|^face_gravity_|^sculp_/.test(name) || isHeadMotionCorrective(name)) return "advanced";
  if (/^eye_[lr]_brows_/.test(name)) return "brows";
  if (/^eye_[lr]_dir_/.test(name)) return "gaze";
  if (/^eye_/.test(name)) return "lids";
  if (/^nose_/.test(name)) return "nose";
  if (/^cheek_|nasolabial/i.test(name)) return "cheeks";
  if (/^lips_/.test(name)) return "mouth";
  if (/^jaw_/.test(name)) return "jaw";
  if (/^(neck|head)_/.test(name)) return "neck";
  if (/^ear_/.test(name)) return "ears";
  return "other";
}

/** Friendly labels by pair key or centre name; a name missing here reads as its words ("lips_mid_shift_up" → "Lips mid shift up"). */
const LABELS: Readonly<Record<string, string>> = {
  eye_brows_raise_in: "Inner brow raise", eye_brows_raise_out: "Outer brow raise", eye_brows_lower: "Brow lower",
  eye_brows_lateral: "Brows draw together", eye_blink: "Close lid", eye_widen: "Widen eye", eye_oculi_squint_inner: "Squint, inner",
  eye_oculi_squint_outer_lower: "Cheek raise (squint, lower outer)", eye_oculi_squint_outer_upper: "Outer brow and lid down (squint, upper outer)",
  eye_pupil_narrow: "Pupil narrow", eye_pupil_wide: "Pupil wide",
  eye_dir_up: "Look up", eye_dir_dn: "Look down", eye_dir_in: "Look in (toward the nose)", eye_dir_out: "Look out (away from the nose)",
  nose_compress: "Nostril compress", nose_breathe_in: "Nostril flare (breathe in)", nose_breathe_out: "Nostril narrow (breathe out)",
  nose_snear: "Nose sneer", lips_nasolabialDeepener: "Smile line deepen", cheek_suck: "Cheek suck in", cheek_puff: "Cheek puff",
  lips_upper_raise: "Upper lip raise", lips_pull: "Upper lip raise, inner", lips_corner_up: "Mouth corner up (smile)",
  lips_corner_wide: "Mouth corner back (dimple)", lips_corner_stretch: "Mouth corner stretch", lips_stretch: "Lip stretch",
  lips_corner_sharp_up: "Mouth corner sharp up", lips_suck_up: "Upper lip suck in", lips_suck_dn: "Lower lip suck in",
  lips_puff_up: "Upper lip puff", lips_puff_dn: "Lower lip puff", lips_apart_up: "Upper lip part", lips_apart_dn: "Lower lip part",
  lips_lower_raise: "Lower lip down", lips_corner_dn: "Mouth corner down (frown)", lips_chin_raise: "Chin raise",
  lips_together_up: "Upper lip seal", lips_together_dn: "Lower lip seal", lips_purse: "Lip purse", lips_funnel: "Lip funnel",
  lips_tighten_up: "Upper lip tighten", lips_tighten_dn: "Lower lip tighten", lips_mid_shift: "Mouth shift",
  lips_mid_shift_up: "Mouth shift up", lips_mid_shift_dn: "Mouth shift down",
  jaw_mid_open: "Jaw open", jaw_mid_close: "Jaw close (undoes Jaw open)", jaw_mid_shift: "Jaw shift", jaw_mid_shift_fwd: "Jaw forward",
  jaw_mid_shift_back: "Jaw back", jaw_mid_clench: "Jaw clench",
  neck_stretch: "Neck stretch", neck_tighten: "Neck tighten", neck_sternocleidomastoid_flex: "Neck side muscle flex",
  neck_platysma_flex: "Neck front muscle flex", neck_throat_adamsApple_up: "Adam's apple up", neck_throat_adamsApple_dn: "Adam's apple down",
  neck_throat_compress: "Throat compress", neck_throat_open: "Throat open", neck_turn: "Neck turn", neck_up_turn: "Neck turn up",
  neck_dn_turn: "Neck turn down", neck_tilt: "Neck tilt", head_neck_up_turn: "Head up (neck skin)", head_neck_dn_turn: "Head down (neck skin)",
  head_neck_tilt: "Head tilt (neck skin)",
  ear_shift_up: "Ear raise", sculp_mid_slide: "Sculpt slide", face_gravity: "Face gravity", face_gravity_fwd: "Face gravity forward",
  face_gravity_back: "Face gravity back", lips_corner_sticky: "Sticky lips",
};
/** Where a direction pair's side word is a direction, the label says which way ("Jaw shift left"). */
const DIRECTION_SUFFIX = /_(?:l|r)$/;

/** The label of a control, without the side for a mirror pair (the drawer adds ", left"/", right"). */
export function controlLabel(name: string): string {
  const key = pairKey(name) ?? name;
  const known = LABELS[key];
  if (known && DIRECTION_SUFFIX.test(name)) return `${known} ${controlSide(name)}`;
  if (known) return known;
  const words = key.replace(/([a-z])([A-Z])/g, "$1 $2").split("_").filter(Boolean)
    .map(word => ({ dn: "down", fwd: "forward", mid: "", in: "in", cutScene: "(cutscene)" } as Record<string, string>)[word] ?? word)
    .filter(Boolean).join(" ").toLowerCase();
  const text = DIRECTION_SUFFIX.test(name) ? `${words} ${controlSide(name)}` : words;
  return text.charAt(0).toUpperCase() + text.slice(1);
}
/** A plain note where a control does something other than its name suggests, or the preview can't show it. */
function controlNote(name: string): string | undefined {
  if (/_pupil_/.test(name)) return "The preview doesn't show pupil size.";
  if (/^tongue_/.test(name)) return "The preview doesn't show the tongue well.";
  if (/^lips_together_/.test(name)) return "Brings the lips together while the jaw is open; closed lips don't change.";
  // Modifiers: alone they move nothing; with their partner control they change its shape (research/animation/natural-expressions.md §3.2).
  if (/^lips_tighten_(up|dn)$/.test(name)) return `Changes only the ${name.endsWith("up") ? "upper" : "lower"} lip seal or puff; alone it does nothing.`;
  if (name === "jaw_mid_clench") return "Changes only Jaw close; alone it does nothing.";
  if (name === "neck_throat_adamsApple_up") return "Works only against Adam's apple down; alone it does nothing.";
  if (isHeadMotionCorrective(name)) return "Shapes the neck skin for a head turn or tilt; the head itself doesn't move.";
  return undefined;
}

/**
 * Read the vocabulary from a skeleton's track names and reference values and a facial setup's track mapping. Throws a plain error
 * when they don't fit together (another rig's setup, a damaged file).
 */
export function buildVocabulary(input: { rig: string; setup: string; trackNames: readonly string[]; referenceTracks: readonly number[];
  mapping: TracksMapping }): FacialVocabulary {
  const { trackNames, referenceTracks, mapping } = input;
  const start = mapping.numEnvelopes, count = mapping.numMainPoses;
  if (!Number.isInteger(start) || !Number.isInteger(count) || start < 0 || count <= 0 || start + count > trackNames.length)
    throw Error("The facial setup's track mapping doesn't fit this head's skeleton.");
  if (referenceTracks.length !== trackNames.length || !referenceTracks.every(Number.isFinite))
    throw Error("The head's skeleton has damaged reference tracks.");
  const names = trackNames.slice(start, start + count);
  if (new Set(names).size !== names.length || names.some(name => typeof name !== "string" || !name))
    throw Error("The head's skeleton names a face control twice.");
  const present = new Set(names);
  const controls = names.map((name, index): ControlInfo => {
    const mirrored = mirrorName(name), partner = mirrored !== name && present.has(mirrored) ? mirrored : null;
    const note = controlNote(name);
    const label = controlLabel(name), side = partner ? controlSide(name) : null;
    return Object.freeze({ name, track: start + index, group: controlGroup(name), label,
      text: side && !DIRECTION_SUFFIX.test(name) ? `${label}, ${side}` : label,
      side, partner, pair: partner ? pairKey(name) : null,
      direction: !!partner && isDirectionPair(name), ...(note ? { note } : {}) });
  });
  return Object.freeze({ rig: input.rig, setup: input.setup, tracks: Object.freeze([...trackNames]),
    reference: Object.freeze([...referenceTracks]), main: Object.freeze({ start, count }), controls: Object.freeze(controls) });
}

/** Controls by name. */
export function controlIndex(vocabulary: FacialVocabulary): ReadonlyMap<string, ControlInfo> {
  return new Map(vocabulary.controls.map(control => [control.name, control]));
}
