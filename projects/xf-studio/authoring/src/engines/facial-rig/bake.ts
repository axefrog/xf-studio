/**
 * Face motion baked for the preview, from XF Studio's own solver (solver.ts): a clip's frames solved and composed into each moving joint's
 * local transform in glTF axes, the form the idle and blink bakes always had (knowledge/facial-animation.md §5), and the eye shapes' joint
 * seats for the blink. Pure: compiled rig, clip tracks and records in, typed arrays and plain records out.
 */
import { clipValuesAt, type ClipTracks } from "./anim-tracks";
import { type CompiledFacialRig, composeLocalPose, createFacialPose, solveFace } from "./solver";

/** A face skeleton at rest in glTF axes: per joint its name, parent index (−1 for a root), local translation, rotation (x, y, z, w) and scale. */
export type BakedRest = { readonly names: readonly string[]; readonly parents: readonly number[]; readonly local: Float32Array /* 10·J */ };
/** Solved frames: the joints that move in any of them (rig indices) and, per frame and moving joint, translation (3) then rotation (4). */
export type BakedFrames = { readonly joints: readonly number[]; readonly times: Float32Array; readonly local: Float32Array /* F·n·7 */ };

/** The rig's rest in glTF axes (the skeleton the baked locals are relative to). */
export function bakedRest(rig: CompiledFacialRig): BakedRest {
  const J = rig.jointNames.length, pose = createFacialPose(rig), local = new Float32Array(J * 10);
  for (let j = 0; j < J; j++) pose.rotations[j * 4 + 3] = 1;
  composeLocalPose(rig, pose, local, "gltf");
  return { names: rig.jointNames, parents: [...rig.parentIndices], local };
}

/** A local transform differs from the rest by more than rounding. */
const MOVED = 1e-7;

/**
 * Solve absolute track frames (reference plus clip values, spec §3.3) and keep each moving joint's composed local transform in glTF axes.
 * A joint that never leaves its rest is left out, as the bakes left it out; the rest skeleton holds it.
 */
export function bakeFrames(rig: CompiledFacialRig, frames: readonly Float32Array[], times: readonly number[]): BakedFrames {
  const J = rig.jointNames.length, F = frames.length, rest = bakedRest(rig).local;
  const pose = createFacialPose(rig), all = new Float32Array(F * J * 10), moved = new Uint8Array(J);
  const one = new Float32Array(J * 10);
  frames.forEach((frame, f) => {
    solveFace(rig, frame, pose);
    composeLocalPose(rig, pose, one, "gltf");
    all.set(one, f * J * 10);
    for (let j = 0; j < J; j++) {
      if (moved[j]) continue;
      for (let c = 0; c < 7; c++) if (Math.abs(one[j * 10 + c]! - rest[j * 10 + c]!) > MOVED) { moved[j] = 1; break; }
    }
  });
  const joints = [...moved.keys()].filter(j => moved[j]), n = joints.length, local = new Float32Array(F * n * 7);
  for (let f = 0; f < F; f++) joints.forEach((j, i) => local.set(all.subarray((f * J + j) * 10, (f * J + j) * 10 + 7), (f * n + i) * 7));
  return { joints, times: Float32Array.from(times), local };
}

/** Bake several clips on one joint set (a joint that moves in any of them is kept in all, as one bake of a rig's clips has it). */
export function bakeClips(rig: CompiledFacialRig, clips: readonly { frames: readonly Float32Array[]; times: readonly number[] }[]): BakedFrames[] {
  const all = bakeFrames(rig, clips.flatMap(clip => clip.frames), clips.flatMap(clip => clip.times)), n = all.joints.length;
  let at = 0;
  return clips.map(clip => {
    const count = clip.frames.length, part = { joints: all.joints, times: Float32Array.from(clip.times), local: all.local.slice(at * n * 7, (at + count) * n * 7) };
    at += count;
    return part;
  });
}

/** The reference tracks plus a clip's values at `time` (`AdditiveFromRefPose`: the clip adds to the rest). */
export function clipFrame(rig: CompiledFacialRig, clip: ClipTracks, time: number, into = rig.referenceTracks()): Float32Array {
  const reference = rig.referenceTracks();
  into.set(reference);
  for (const [track, value] of clipValuesAt(clip, time)) if (track < into.length) into[track] = reference[track]! + value;
  return into;
}

/** A clip at `rate` Hz from its start to its end: round(duration × rate) + 1 frames, the idle bake's samples. */
export function clipTimes(duration: number, rate: number): number[] {
  const count = Math.round(duration * rate) + 1;
  return Array.from({ length: count }, (_, i) => Math.min(duration, i / rate));
}

/**
 * A creator section's showcase played once before the loop (knowledge/facial-expressions.md §5; research/animation/cc-idle.md), linearly
 * in track space before the solve [hypothesis: the face graph's 0.5 s transitions blend tracks]: the showcase blended in from the loop over
 * `blend` seconds, played to its end at `loopFrom − blend`, where the loop starts again from 0 underneath and the showcase blends out into it
 * over `blend` seconds; from `loopFrom` the loop alone, one whole pass wrapped (so the Studio can loop from `loopFrom`). Fitted frame for
 * frame to the developer bake's timeline (tools/facial-bake-oracle.ts). Returns the absolute track frames and their times (frame i at i / rate).
 */
export function introFrames(rig: CompiledFacialRig, intro: ClipTracks, loop: ClipTracks, options: { rate: number; blend: number; loopFrom: number }): { frames: Float32Array[]; times: number[] } {
  const { rate, blend, loopFrom } = options, introEnd = loopFrom - blend, total = loopFrom + loop.duration, times = clipTimes(total, rate);
  const a = rig.referenceTracks(), b = rig.referenceTracks();
  const frames = times.map(t => {
    const loopTime = t < introEnd ? t : (t - introEnd) % loop.duration;
    if (t >= loopFrom) return clipFrame(rig, loop, loopTime);
    const showcase = clipFrame(rig, intro, Math.min(t, intro.duration), a), under = clipFrame(rig, loop, loopTime, b);
    const w = t < blend ? t / blend : t < introEnd ? 1 : Math.max(0, 1 - (t - introEnd) / blend);
    const out = new Float32Array(a.length);
    for (let k = 0; k < out.length; k++) out[k] = under[k]! + w * (showcase[k]! - under[k]!);
    return out;
  });
  return { frames, times };
}

/* ------------------------------------------------------------------------------------------------------------------------------------ */
/* Eye-shape seats                                                                                                                        */

/** How near an eye joint (metres) an unlisted eye-region joint must sit to follow it: 0.1 mm (the lid and wetness roots sit on it). */
const SEAT_ON_EYE = 1e-4;
/** One morph target's joint binds as the file stores them: joint names and their rig matrices (REDengine, the inverse of the world bind). */
export type MorphTargetBinds = { readonly name: string; readonly region: string; readonly bones: readonly string[];
  /** Per bone, the 4×4 rig matrix's rows X, Y, Z, W as (x, y, z, w) each. */
  readonly matrices: readonly (readonly number[])[] };
/** A joint's world bind in glTF axes: position then rotation quaternion (x, y, z, w) (game-blink.ts `ShapeBind`). */
export type ShapeBindValue = [number, number, number, number, number, number, number];

type M4 = number[];
/** Column-vector 4×4 (m[row * 4 + col]) from a row-vector rig matrix (rows X, Y, Z basis, W translation). */
function fromRig(rows: readonly number[]): M4 {
  const [xx, xy, xz, , yx, yy, yz, , zx, zy, zz, , wx, wy, wz] = rows as number[];
  return [xx!, yx!, zx!, wx!, xy!, yy!, zy!, wy!, xz!, yz!, zz!, wz!, 0, 0, 0, 1];
}
function invertAffine(m: M4): M4 {
  // Rotation-and-scale block inverse by cofactors (the binds are orthonormal to float precision, but scale is not assumed away).
  const a = m[0]!, b = m[1]!, c = m[2]!, d = m[4]!, e = m[5]!, f = m[6]!, g = m[8]!, h = m[9]!, i = m[10]!;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
  const inv = [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
  const tx = m[3]!, ty = m[7]!, tz = m[11]!;
  return [inv[0]!, inv[1]!, inv[2]!, -(inv[0]! * tx + inv[1]! * ty + inv[2]! * tz), inv[3]!, inv[4]!, inv[5]!, -(inv[3]! * tx + inv[4]! * ty + inv[5]! * tz),
    inv[6]!, inv[7]!, inv[8]!, -(inv[6]! * tx + inv[7]! * ty + inv[8]! * tz), 0, 0, 0, 1];
}
function multiply(a: M4, b: M4): M4 {
  const out = new Array<number>(16);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) out[r * 4 + c] = a[r * 4]! * b[c]! + a[r * 4 + 1]! * b[4 + c]! + a[r * 4 + 2]! * b[8 + c]! + a[r * 4 + 3]! * b[12 + c]!;
  return out;
}
/** REDengine (Z up) to glTF (Y up): (x, y, z) → (x, z, −y). */
const G: M4 = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1], G_INV: M4 = [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1];
function decompose(m: M4): ShapeBindValue {
  const sx = Math.hypot(m[0]!, m[4]!, m[8]!), sy = Math.hypot(m[1]!, m[5]!, m[9]!), sz = Math.hypot(m[2]!, m[6]!, m[10]!);
  const r00 = m[0]! / sx, r01 = m[1]! / sy, r02 = m[2]! / sz, r10 = m[4]! / sx, r11 = m[5]! / sy, r12 = m[6]! / sz, r20 = m[8]! / sx, r21 = m[9]! / sy, r22 = m[10]! / sz;
  const trace = r00 + r11 + r22;
  let x: number, y: number, z: number, w: number;
  if (trace > 0) { const s = 0.5 / Math.sqrt(trace + 1); w = 0.25 / s; x = (r21 - r12) * s; y = (r02 - r20) * s; z = (r10 - r01) * s; }
  else if (r00 > r11 && r00 > r22) { const s = 2 * Math.sqrt(1 + r00 - r11 - r22); w = (r21 - r12) / s; x = 0.25 * s; y = (r01 + r10) / s; z = (r02 + r20) / s; }
  else if (r11 > r22) { const s = 2 * Math.sqrt(1 + r11 - r00 - r22); w = (r02 - r20) / s; x = (r01 + r10) / s; y = 0.25 * s; z = (r12 + r21) / s; }
  else { const s = 2 * Math.sqrt(1 + r22 - r00 - r11); w = (r10 - r01) / s; x = (r02 + r20) / s; y = (r12 + r21) / s; z = 0.25 * s; }
  return [m[3]!, m[7]!, m[11]!, x, y, z, w];
}
/** A joint's world bind from its rig matrix, in glTF axes. */
export function bindFromRigMatrix(rows: readonly number[]): M4 { return multiply(multiply(G, invertAffine(fromRig(rows))), G_INV); }

/** World matrices of the rest skeleton (glTF axes), from `bakedRest`. */
function restWorlds(rest: BakedRest): M4[] {
  const out: M4[] = [];
  rest.names.forEach((_, j) => {
    const o = j * 10, [tx, ty, tz, x, y, z, w, sx, sy, sz] = Array.from(rest.local.subarray(o, o + 10));
    const local: M4 = [(1 - 2 * (y! * y! + z! * z!)) * sx!, 2 * (x! * y! - z! * w!) * sy!, 2 * (x! * z! + y! * w!) * sz!, tx!,
      2 * (x! * y! + z! * w!) * sx!, (1 - 2 * (x! * x! + z! * z!)) * sy!, 2 * (y! * z! - x! * w!) * sz!, ty!,
      2 * (x! * z! - y! * w!) * sx!, 2 * (y! * z! + x! * w!) * sy!, (1 - 2 * (x! * x! + y! * y!)) * sz!, tz!, 0, 0, 0, 1];
    out.push(rest.parents[j]! >= 0 ? multiply(out[rest.parents[j]!]!, local) : local);
  });
  return out;
}

/**
 * Each eye shape's joint seats (knowledge/facial-animation.md §4, the reading the Studio adopted): for every eye target of the head's morph
 * targets (region `eyes`), the eye-region joints (`JointRegions` 0) that the head's target or the eye mesh's target of the same name lists sit
 * at their own binds; the unskinned joints no target lists that sit on an eye joint (the lid and wetness roots) follow that eye joint.
 * The other eye-region joints are left out (they keep their rest relative to their parent).
 */
export function eyeShapeSeats(rest: BakedRest, regions: readonly number[], head: readonly MorphTargetBinds[], eye: readonly MorphTargetBinds[]): Record<string, Record<string, ShapeBindValue>> {
  const worlds = restWorlds(rest), index = new Map(rest.names.map((name, j) => [name, j] as const));
  const inEyes = (name: string) => { const j = index.get(name); return j !== undefined && regions[j] === 0; };
  const eyeJoints = rest.names.filter(name => /^[lr]_J_eye_JNT$/.test(name));
  const position = (m: M4) => [m[3]!, m[7]!, m[11]!];
  const out: Record<string, Record<string, ShapeBindValue>> = {};
  for (const target of head.filter(t => t.region === "eyes")) {
    const binds = new Map<string, M4>();
    const take = (t: MorphTargetBinds | undefined) => t?.bones.forEach((bone, i) => { if (inEyes(bone) && t.matrices[i]) binds.set(bone, bindFromRigMatrix(t.matrices[i]!)); });
    take(target);
    take(eye.find(t => t.name === target.name));
    // Unlisted joints on an eye joint follow it: seat = eye seat · eye rest⁻¹ · joint rest.
    for (const eyeName of eyeJoints) {
      const eyeSeat = binds.get(eyeName), e = index.get(eyeName);
      if (!eyeSeat || e === undefined) continue;
      const at = position(worlds[e]!), follow = multiply(eyeSeat, invertAffine(worlds[e]!));
      rest.names.forEach((name, j) => {
        if (binds.has(name) || !inEyes(name) || name === eyeName || name[0] !== eyeName[0]) return;
        const p = position(worlds[j]!);
        if (Math.hypot(p[0]! - at[0]!, p[1]! - at[1]!, p[2]! - at[2]!) < SEAT_ON_EYE) binds.set(name, multiply(follow, worlds[j]!));
      });
    }
    if (binds.size) out[target.name] = Object.fromEntries([...binds].map(([name, m]) => [name, decompose(m)]));
  }
  return out;
}
