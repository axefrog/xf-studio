/**
 * Symmetry and opposing pairs of V's face controls (research/animation/natural-expressions.md §10; knowledge/facial-expressions.md §8).
 * Pure name rules over the control vocabulary, which the host's solver checks against the rig when it starts (facial-host.ts
 * `findRelations`): the Studio offers a bipolar control only for a pair the solver confirmed moves the same thing both ways.
 *
 * - **Mirror image** (`mirrorName`, vocabulary.ts): the control on the other side with the side token swapped. Solving confirms every
 *   left/right pair is an exact mirror image (reflected motion matches at cosine 1.00), gaze included: the rig's gaze is anatomical,
 *   `eye_[lr]_dir_in` turns each eye toward the nose.
 * - **Counterpart** (`counterpartName`): what a linked (symmetric) edit also sets. For skin controls it is the mirror image. For
 *   horizontal gaze it is the other eye's *opposite* direction (`eye_l_dir_in` ↔ `eye_r_dir_out`), so both eyes keep looking the same
 *   way instead of crossing. Vertical gaze copies straight. Centre controls and lateral direction pairs (jaw shift, mouth shift, neck
 *   turn and tilt, face gravity, tongue) have no counterpart: a symmetric face can't lean to one side.
 * - **Opposites** (`oppositeCandidates`): the control that moves the same thing the other way: a direction word swapped (in/out, up/dn,
 *   fwd/back, front/back) or, for a lateral direction pair, the other side. Names only propose; the solver decides.
 * - **Bipolar axis**: an opposing pair as one value from −1 to +1: the negative end is `max(0, −v)`, the positive end `max(0, v)`.
 *   Reading keeps both raw weights (a stored or game expression may set both), so nothing is lost until the axis is edited.
 */
import { controlSide, isDirectionPair, mirrorName, pairKey } from "./vocabulary";
import { f32, withControl, type ControlVector } from "./vector";

const tokens = (name: string) => name.split("_");
/** Horizontal gaze: a per-eye look in or out. */
export const isHorizontalGaze = (name: string) => /^eye_[lr]_dir_(?:in|out)$/.test(name);
/** Any gaze direction control. */
export const isGaze = (name: string) => /^eye_[lr]_dir_(?:in|out|up|dn)$/.test(name);

/** What a linked edit of `name` also sets (the same weight), or null (a centre control, a lateral direction pair). */
export function counterpartName(name: string): string | null {
  if (isHorizontalGaze(name)) return mirrorName(name).replace(/_(in|out)$/, (_, word: string) => word === "in" ? "_out" : "_in");
  if (isGaze(name)) return mirrorName(name);
  if (!controlSide(name) || isDirectionPair(name)) return null;
  const partner = mirrorName(name);
  return partner === name ? null : partner;
}
/** The key a pair's link is stored under (`ExpressionPart.links`): shared by a control and its counterpart. */
export function linkKey(name: string): string | null {
  if (isHorizontalGaze(name)) return "eye_dir_h";
  return counterpartName(name) ? pairKey(name) : null;
}
/** Whether a pair starts linked when the part says nothing: every pair with a counterpart (gaze included) does. */
export const linkedByDefault = (name: string) => counterpartName(name) !== null;

const OPPOSITE_WORD: Readonly<Record<string, readonly string[]>> = { in: ["out"], out: ["in"], up: ["dn"], dn: ["up"], fwd: ["back"],
  back: ["fwd", "front"], front: ["back"] };
/** Controls that may move the same thing the other way (name proposals; `findRelations` keeps those the solver confirms). */
export function oppositeCandidates(name: string): string[] {
  const parts = tokens(name), found = new Set<string>();
  parts.forEach((token, at) => {
    for (const other of OPPOSITE_WORD[token] ?? []) found.add([...parts.slice(0, at), other, ...parts.slice(at + 1)].join("_"));
  });
  if (isDirectionPair(name) && !isGaze(name)) { const other = mirrorName(name); if (other !== name) found.add(other); }
  found.delete(name);
  return [...found];
}

/** An opposing pair the solver confirmed, oriented: `negative` is the end toward V's left, down or back (or inward, `frame: "outward"`). */
export type AxisPair = { readonly negative: string; readonly positive: string; readonly direction: "lateral" | "vertical" | "depth";
  /** How the lateral ends are named: `world` (V's own left and right: gaze, centre controls) or `outward` (away from the midline). */
  readonly frame: "world" | "outward" };
/** A bipolar control over an axis pair: its label and end words for a person. */
export type FacialAxis = AxisPair & { readonly key: string; readonly label: string; readonly ends: readonly [string, string];
  readonly side: "left" | "right" | null; readonly gaze: boolean };

const END_WORDS: Readonly<Record<AxisPair["direction"], readonly [string, string]>> = { lateral: ["left", "right"], vertical: ["down", "up"], depth: ["back", "forward"] };
/** Readable names of axis stems (the name without its direction word); unknown stems read as their words. */
const AXIS_LABELS: Readonly<Record<string, string>> = {
  eye_dir: "Gaze", nose_breathe: "Nostril", jaw_mid_shift: "Jaw", lips_mid_shift: "Mouth", neck_turn: "Neck turn", neck_tilt: "Neck tilt",
  head_neck_turn: "Head turn (neck skin)", head_neck_tilt: "Head tilt (neck skin)", face_gravity: "Face gravity", tongue_mid_base: "Tongue base",
  tongue_mid_tip: "Tongue tip", tongue_mid_twist: "Tongue twist", neck_throat: "Throat",
};
/** The stem both ends share: the name without the tokens where they differ, and without the side. */
function stem(a: string, b: string): string {
  const x = tokens(a), y = tokens(b);
  return x.filter((token, at) => token === y[at] && token !== "l" && token !== "r").join("_");
}
const words = (key: string) => { const text = key.replace(/_mid\b/g, "").replace(/_/g, " ").trim(); return text.charAt(0).toUpperCase() + text.slice(1); };

/** The bipolar controls for the confirmed pairs, in the order given. */
export function buildAxes(pairs: readonly AxisPair[]): FacialAxis[] {
  return pairs.map(pair => {
    const key = stem(pair.negative, pair.positive), side = controlSide(pair.negative) === controlSide(pair.positive) ? controlSide(pair.negative) : null;
    const gaze = isGaze(pair.negative);
    const ends: readonly [string, string] = pair.direction === "lateral" && pair.frame === "outward" ? ["in", "out"] : END_WORDS[pair.direction];
    const base = AXIS_LABELS[key] ?? words(key);
    const label = gaze ? `${side === "left" ? "Left" : "Right"} eye: look ${ends[0]} ↔ ${ends[1]}` : `${base}${side ? `, ${side}` : ""}: ${ends[0]} ↔ ${ends[1]}`;
    return { ...pair, key: `${pair.negative}~${pair.positive}`, label, ends, side, gaze };
  });
}

/** An axis's value from a vector: the net (positive minus negative), both raw weights, and whether both are set (mixed). */
export function readAxis(vector: ControlVector, axis: Pick<AxisPair, "negative" | "positive">) {
  const negative = vector[axis.negative] ?? 0, positive = vector[axis.positive] ?? 0;
  return { value: positive - negative, negative, positive, mixed: negative > 0 && positive > 0 };
}
/** Write an axis value (−1 to +1): the negative end takes `max(0, −v)`, the positive end `max(0, v)` (float32, zero omitted). */
export function writeAxis(vector: ControlVector, axis: Pick<AxisPair, "negative" | "positive">, value: number): ControlVector {
  const v = Math.max(-1, Math.min(1, value));
  return withControl(withControl(vector, axis.negative, f32(Math.max(0, -v))), axis.positive, f32(Math.max(0, v)));
}
