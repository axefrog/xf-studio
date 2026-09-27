/**
 * Face skeletons and solved poses in the preview's axes. Pure (plain arrays; the scene's face driver turns them into bone matrices).
 *
 * REDengine is Z-up, glTF Y-up: a vector (x, y, z) maps to (x, z, −y) and a quaternion (i, j, k, r) to (i, k, −j, r), the change of
 * basis WolvenKit's rig export and the idle and blink bakes use (tools/bake_game_blink.py `BASIS`). The IO Suite solver answers a local
 * rotation and translation delta per joint, applied after the joint's rest: rotation rest × delta, translation rest + rest-rotated
 * (delta × rest scale), as tools/bake_idle_face.py packs them.
 */

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];
/** One joint of the face skeleton at rest, in glTF axes: its parent's index (−1 for a root) and local transform. */
export type RigJoint = { readonly name: string; readonly parent: number; readonly t: Vec3; readonly r: Quat; readonly s: Vec3 };
export type RigRest = { readonly joints: readonly RigJoint[] };
/** A solved pose: per joint, in rig order, its local rotation (x, y, z, w) and translation delta as the solver answers (REDengine axes). */
export type SolvedPose = { readonly q: Float32Array; readonly t: Float32Array };
/** A joint's posed local transform in glTF axes. */
export type LocalTransform = { t: Vec3; r: Quat };

export const vecToGltf = (x: number, y: number, z: number): Vec3 => [x, z, -y];
export const quatToGltf = (i: number, j: number, k: number, r: number): Quat => [i, k, -j, r];

type RedJoint = { Rotation?: { i?: number; j?: number; k?: number; r?: number }; Translation?: { X?: number; Y?: number; Z?: number };
  Scale?: { X?: number; Y?: number; Z?: number } };
const name = (value: unknown) => typeof value === "string" ? value : (value as { $value?: unknown } | null)?.$value;

/**
 * The rest skeleton of a serialized `.rig` (WolvenKit JSON `RootChunk`: `boneNames`, `boneParentIndexes`, `boneTransforms`) in glTF
 * axes. Throws a plain error for a damaged rig.
 */
export function rigRestFromRed(root: { boneNames?: unknown; boneParentIndexes?: unknown; boneTransforms?: unknown }): RigRest {
  const names = Array.isArray(root.boneNames) ? root.boneNames.map(name) : [];
  const parents = Array.isArray(root.boneParentIndexes) ? root.boneParentIndexes : [];
  const transforms = Array.isArray(root.boneTransforms) ? root.boneTransforms as RedJoint[] : [];
  if (!names.length || names.length !== parents.length || names.length !== transforms.length || names.some(entry => typeof entry !== "string"))
    throw Error("The head's skeleton is damaged.");
  const joints = names.map((jointName, index): RigJoint => {
    const { Rotation: q = {}, Translation: p = {}, Scale: s = {} } = transforms[index] ?? {};
    const parent = Number(parents[index]);
    if (!Number.isInteger(parent) || parent >= index) throw Error("The head's skeleton is damaged.");
    const r = quatToGltf(q.i ?? 0, q.j ?? 0, q.k ?? 0, q.r ?? 1), length = Math.hypot(...r) || 1;
    return Object.freeze({ name: jointName as string, parent: parent < 0 ? -1 : parent, t: vecToGltf(p.X ?? 0, p.Y ?? 0, p.Z ?? 0),
      r: r.map(v => v / length) as Quat, s: [Math.abs(s.X ?? 1), Math.abs(s.Z ?? 1), Math.abs(s.Y ?? 1)] as Vec3 });
  });
  if (joints.some(joint => ![...joint.t, ...joint.r, ...joint.s].every(Number.isFinite))) throw Error("The head's skeleton is damaged.");
  return Object.freeze({ joints: Object.freeze(joints) });
}

function multiply(a: Quat, b: Quat): Quat {
  return [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
}
function rotate(q: Quat, v: Vec3): Vec3 {
  // v + 2 q × (q × v + w v)
  const [x, y, z, w] = q, cx = y * v[2] - z * v[1] + w * v[0], cy = z * v[0] - x * v[2] + w * v[1], cz = x * v[1] - y * v[0] + w * v[2];
  return [v[0] + 2 * (y * cz - z * cy), v[1] + 2 * (z * cx - x * cz), v[2] + 2 * (x * cy - y * cx)];
}

/** How many joints a solved pose holds (it must equal the rest skeleton's). */
export function poseJoints(pose: SolvedPose): number { return pose.q.length / 4; }

/**
 * Each moved joint's posed local transform in glTF axes, by joint index; joints the pose leaves at rest (identity rotation and zero
 * translation within 1e-7) are omitted. Throws when the pose and the skeleton differ in size or hold invalid numbers.
 */
export function posedLocals(rest: RigRest, pose: SolvedPose, frame = 0): Map<number, LocalTransform> {
  const count = rest.joints.length;
  if (pose.q.length % (count * 4) !== 0 || pose.t.length !== pose.q.length / 4 * 3 || (frame + 1) * count * 4 > pose.q.length)
    throw Error("The solved face doesn't match this head's skeleton.");
  const out = new Map<number, LocalTransform>();
  const qBase = frame * count * 4, tBase = frame * count * 3;
  for (let j = 0; j < count; j++) {
    const qi = qBase + j * 4, ti = tBase + j * 3;
    const qx = pose.q[qi]!, qy = pose.q[qi + 1]!, qz = pose.q[qi + 2]!, qw = pose.q[qi + 3]!;
    const tx = pose.t[ti]!, ty = pose.t[ti + 1]!, tz = pose.t[ti + 2]!;
    if (![qx, qy, qz, qw, tx, ty, tz].every(Number.isFinite)) throw Error("The solved face holds invalid numbers.");
    if (Math.abs(qx) < 1e-7 && Math.abs(qy) < 1e-7 && Math.abs(qz) < 1e-7 && Math.abs(qw - 1) < 1e-7 &&
      Math.abs(tx) < 1e-7 && Math.abs(ty) < 1e-7 && Math.abs(tz) < 1e-7) continue;
    const joint = rest.joints[j]!, delta = quatToGltf(qx, qy, qz, qw), length = Math.hypot(...delta) || 1;
    const r = multiply(joint.r, delta.map(v => v / length) as Quat);
    const d = vecToGltf(tx, ty, tz), moved = rotate(joint.r, [d[0] * joint.s[0], d[1] * joint.s[1], d[2] * joint.s[2]]);
    out.set(j, { t: [joint.t[0] + moved[0], joint.t[1] + moved[1], joint.t[2] + moved[2]], r });
  }
  return out;
}
