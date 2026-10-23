/**
 * How far the lips are parted: derived data from the solved face, for the mouth interior's light (mouth-occlusion.ts, PREV-147 step A).
 * Pure and Three-free: the renderer samples the posed bones and asks these functions; tests and experiments call them with plain arrays.
 *
 * **Which joints.** Chosen from the facial setup's own data, never by joint names, so a face rig with other names works the same way
 * (research/character-customization/render-gap-plans.md §1):
 * - the setup's `JointRegions` put the lips in the mouth region (2) and the jaw's joints in the jaw region (3)
 *   (research/animation/facial-solver-spec.md, `bakedData.Data.JointRegions`) [resource];
 * - the lower lip's joints ride on the jaw (a jaw-region ancestor), the upper lip's don't [resource: the player face skeleton];
 * - a lip's "inside" joints hang off its outer joints (a mouth-region parent), so only joints whose parent is outside the mouth region
 *   count, which leaves the outer lip line and the rings of joints around the mouth;
 * - near the midline (within a quarter of the mouth region's half-width of its centre) the **lowest** head-carried joint on each side is the
 *   upper lip's edge, and the **highest** jaw-carried one the lower lip's.
 * On the game's player face skeleton that picks `[lr]_J_mug_lip_up_0_JNT` and `[lr]_J_mug_lip_dn_0_JNT`, the joints experiment 034
 * measured by name [offline, 30 September].
 *
 * **What is measured.** The midline parting: the upper joints' mean height minus the lower joints' along the rest pose's up axis, in the
 * frame of their nearest common ancestor (the `Head` joint on the player's face), so the neck and body moving the head changes nothing;
 * its change from rest, never negative (`mouthAperture`). At the creator idle's two breaths that is 2.75–2.91 mm under the male player
 * setup the preview solves with [offline, experiment 034 §1].
 */

export type Vec3 = readonly [number, number, number];
/** Where a face motion scene keeps its rest and regions (`userData`), for the renderer's aperture sampler. */
export const FACE_REST_KEY = "xfsFaceRest";
/** A face skeleton at rest, as the host's face motion records carry it (glTF axes; per joint t(3), r xyzw(4), s(3)). */
export type FaceRest = { readonly names: readonly string[]; readonly parents: readonly number[]; readonly local: ArrayLike<number> };
/** The facial setup's regions per rig joint (`JointRegions`). */
export const JOINT_REGION = Object.freeze({ eyes: 0, nose: 1, mouth: 2, jaw: 3, ear: 4, none: 255 });

/** The lip joints the parting is measured on, the frame it is measured in, and the parting at rest. */
export type MouthLipJoints = {
  /** The upper and lower lip's edge joints (names), one per side of the midline (or one on it). */
  readonly upper: readonly string[];
  readonly lower: readonly string[];
  /** Their nearest common ancestor (name): positions are measured in its frame. */
  readonly frame: string;
  /** The rest pose's up axis in the frame's own axes (unit). */
  readonly up: Vec3;
  /** The parting at rest (metres along `up`; the lips' own rest thickness, not a gap). */
  readonly rest: number;
};

type Mat = number[]; // column-major 4×4

function compose(t: ArrayLike<number>, o: number): Mat {
  const x = t[o + 3]!, y = t[o + 4]!, z = t[o + 5]!, w = t[o + 6]!, sx = t[o + 7]!, sy = t[o + 8]!, sz = t[o + 9]!;
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    t[o]!, t[o + 1]!, t[o + 2]!, 1];
}
function multiply(a: Mat, b: Mat): Mat {
  const out = new Array<number>(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
    out[c * 4 + r] = a[r]! * b[c * 4]! + a[4 + r]! * b[c * 4 + 1]! + a[8 + r]! * b[c * 4 + 2]! + a[12 + r]! * b[c * 4 + 3]!;
  return out;
}
/** The inverse of an affine matrix (rotation, scale, translation). */
function invertAffine(m: Mat): Mat {
  const [a, b, c, , d, e, f, , g, h, i] = m as [number, number, number, number, number, number, number, number, number, number, number];
  const det = a * (e * i - f * h) - d * (b * i - c * h) + g * (b * f - c * e);
  const k = 1 / det;
  const r = [(e * i - f * h) * k, (c * h - b * i) * k, (b * f - c * e) * k, (f * g - d * i) * k, (a * i - c * g) * k, (c * d - a * f) * k,
    (d * h - e * g) * k, (b * g - a * h) * k, (a * e - b * d) * k];
  const tx = m[12]!, ty = m[13]!, tz = m[14]!;
  return [r[0]!, r[1]!, r[2]!, 0, r[3]!, r[4]!, r[5]!, 0, r[6]!, r[7]!, r[8]!, 0,
    -(r[0]! * tx + r[3]! * ty + r[6]! * tz), -(r[1]! * tx + r[4]! * ty + r[7]! * tz), -(r[2]! * tx + r[5]! * ty + r[8]! * tz), 1];
}
const apply = (m: Mat, v: Vec3): Vec3 => [m[0]! * v[0] + m[4]! * v[1] + m[8]! * v[2] + m[12]!, m[1]! * v[0] + m[5]! * v[1] + m[9]! * v[2] + m[13]!,
  m[2]! * v[0] + m[6]! * v[1] + m[10]! * v[2] + m[14]!];

/** Every joint's rest transform in the skeleton's space (parents precede children in a face rest; a later parent is a root). */
export function restWorlds(rest: FaceRest): Mat[] {
  const out: Mat[] = [];
  rest.names.forEach((_, j) => {
    const local = compose(rest.local, j * 10), parent = rest.parents[j]!;
    out.push(parent >= 0 && parent < j ? multiply(out[parent]!, local) : local);
  });
  return out;
}

/** The lip joints of a face, chosen from its setup's regions (see the module note); null when the face has no such joints. */
export function mouthLipJoints(rest: FaceRest, regions: readonly number[]): MouthLipJoints | null {
  const count = rest.names.length;
  if (regions.length !== count || rest.parents.length !== count || rest.local.length !== count * 10) return null;
  const worlds = restWorlds(rest), position = (j: number): Vec3 => [worlds[j]![12]!, worlds[j]![13]!, worlds[j]![14]!];
  const inMouth = (j: number) => regions[j] === JOINT_REGION.mouth;
  const ancestors = (j: number) => { const out: number[] = []; for (let p = rest.parents[j]!; p >= 0 && out.length < count; p = rest.parents[p]!) out.push(p); return out; };
  const mouth = rest.names.map((_, j) => j).filter(inMouth);
  if (!mouth.length) return null;
  const centre = mouth.reduce((sum, j) => sum + position(j)[0], 0) / mouth.length;
  const band = Math.max(...mouth.map(j => Math.abs(position(j)[0] - centre))) / 4;
  const outer = mouth.filter(j => { const p = rest.parents[j]!; return !(p >= 0 && inMouth(p)) && Math.abs(position(j)[0] - centre) <= band; });
  const onJaw = (j: number) => ancestors(j).some(a => regions[a] === JOINT_REGION.jaw);
  const side = (j: number) => { const dx = position(j)[0] - centre; return Math.abs(dx) < 1e-5 ? 0 : Math.sign(dx); };
  const pick = (candidates: number[], better: (a: number, b: number) => boolean) => {
    const best = new Map<number, number>();
    for (const j of candidates) { const s = side(j), held = best.get(s); if (held === undefined || better(j, held)) best.set(s, j); }
    return [...best.values()];
  };
  const upper = pick(outer.filter(j => !onJaw(j)), (a, b) => position(a)[1] < position(b)[1]);
  const lower = pick(outer.filter(onJaw), (a, b) => position(a)[1] > position(b)[1]);
  if (!upper.length || !lower.length) return null;
  // The nearest common ancestor of every chosen joint.
  const chains = [...upper, ...lower].map(j => [j, ...ancestors(j)]);
  const frame = chains[0]!.find(j => chains.every(chain => chain.includes(j)));
  if (frame === undefined) return null;
  const inverse = invertAffine(worlds[frame]!), rotation = [...worlds[frame]!.slice(0, 12), 0, 0, 0, 1];
  // The rest's up (+y, glTF axes) in the frame's own axes: the transpose of its rotation (scale removed) applied to it.
  const len = (c: number) => Math.hypot(rotation[c * 4]!, rotation[c * 4 + 1]!, rotation[c * 4 + 2]!);
  const up: Vec3 = [rotation[1]! / len(0), rotation[5]! / len(1), rotation[9]! / len(2)];
  const norm = Math.hypot(...up);
  const unit: Vec3 = [up[0] / norm, up[1] / norm, up[2] / norm];
  const local = (list: number[]) => list.map(j => apply(inverse, position(j)));
  return { upper: upper.map(j => rest.names[j]!), lower: lower.map(j => rest.names[j]!), frame: rest.names[frame]!, up: unit,
    rest: lipParting(local(upper), local(lower), unit) };
}

/**
 * The parting of a whole posed skeleton (the rest's form with posed locals: a baked frame over the rest), for offline checks; the scene
 * measures its own posed bones instead.
 */
export function posedParting(pose: FaceRest, lips: MouthLipJoints): number {
  const worlds = restWorlds(pose), index = (name: string) => pose.names.indexOf(name);
  const frame = index(lips.frame);
  if (frame < 0) return Number.NaN;
  const inverse = invertAffine(worlds[frame]!);
  const local = (names: readonly string[]) => names.map(name => { const m = worlds[index(name)]!; return apply(inverse, [m[12]!, m[13]!, m[14]!]); });
  return lipParting(local(lips.upper), local(lips.lower), lips.up);
}

/** The midline parting in a frame: the mean of `upper` minus the mean of `lower`, along `up` (metres). */
export function lipParting(upper: readonly Vec3[], lower: readonly Vec3[], up: Vec3): number {
  const along = (list: readonly Vec3[]) => list.reduce((sum, p) => sum + p[0] * up[0] + p[1] * up[1] + p[2] * up[2], 0) / list.length;
  return along(upper) - along(lower);
}

/** The lips' aperture: the parting's change from rest, never negative (metres; 0 with the lips closed). */
export function mouthAperture(posed: number, rest: number): number {
  const opened = posed - rest;
  return Number.isFinite(opened) && opened > 0 ? opened : 0;
}
