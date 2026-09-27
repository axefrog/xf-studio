import * as THREE from "three";
import type { PoseSample } from "./pose-sample";

/**
 * A photo-mode pose as a body clip for the preview's idle rig (pose-library-design.md §5.2, P2). The host samples the pose's clip on its
 * rig in game axes (Z up), local to each joint's parent (`xfs/pose-sample-1`); the idle's body clips are WolvenKit glTF exports of the same
 * `woman_base.rig`, whose every node carries the game transform conjugated into glTF axes: (x, y, z) → (x, z, −y), a rotation's axis the
 * same way, a scale's axes swapped (the anim oracle's `toGltf`, checked against WolvenKit on 21 clips). So a pose plays on the same rigs
 * as the idles, and the deformation rig evaluates the helper joints for it as it does for them.
 *
 * - **Held pose**: one key per channel at 0 s, in a clip one second long (the mixer's phase is taken modulo the length).
 * - **Moving pose** (`motion`): the changing channels at every frame over the clip's length, looping; the others held.
 * - **Placement**: the record's `positionOffset` and `rotation` move the whole character: they are applied to `Root`, V's scene origin.
 *   Offset in metres and rotation as Euler degrees about the game's X, Y then Z axes [hypothesis: G7 in the design's in-game checks].
 * - `Trajectory` and motion extraction are left as the clip holds them (the decoder leaves root motion out), so V stays in place.
 */
export type PosePlacement = { readonly offset: readonly [number, number, number]; readonly rotation: readonly [number, number, number] };
export type PoseClip = {
  readonly clip: THREE.AnimationClip;
  /** Whether the body moves by itself (a moving pose), so playback must keep drawing. */
  readonly moves: boolean;
  /** Where the loop starts: the record's `animationTime` within the clip (0 for a held pose, whose one frame is already that time). */
  readonly start: number;
};

/** A game-space translation in glTF axes. */
export const translationToGltf = (v: readonly number[]): [number, number, number] => [v[0]!, v[2]!, -v[1]!];
/** A game-space rotation (x, y, z, w) in glTF axes. */
export const rotationToGltf = (q: readonly number[]): [number, number, number, number] => [q[0]!, q[2]!, -q[1]!, q[3]!];
/** A game-space scale in glTF axes. */
export const scaleToGltf = (s: readonly number[]): [number, number, number] => [s[0]!, s[2]!, s[1]!];

const DEG = Math.PI / 180;
/** The placement as a game-space transform, then in glTF axes. */
function placementMatrix(placement: PosePlacement | undefined): THREE.Matrix4 | null {
  if (!placement) return null;
  const [ox, oy, oz] = placement.offset, [rx, ry, rz] = placement.rotation;
  if (![ox, oy, oz, rx, ry, rz].every(Number.isFinite) || (ox === 0 && oy === 0 && oz === 0 && rx === 0 && ry === 0 && rz === 0)) return null;
  const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx * DEG, ry * DEG, rz * DEG, "XYZ"));
  const gl = new THREE.Quaternion(...rotationToGltf([rotation.x, rotation.y, rotation.z, rotation.w]));
  return new THREE.Matrix4().compose(new THREE.Vector3(...translationToGltf([ox, oy, oz])), gl, new THREE.Vector3(1, 1, 1));
}

/** The pose's body clip, keyed on the rig's joint names (`Root`, `Hips`…) as the idle's body clips are. */
export function poseClip(sample: PoseSample, placement?: PosePlacement): PoseClip {
  const place = placementMatrix(placement);
  const motion = sample.motion && sample.motion.frames > 1 && sample.motion.rate > 0 ? sample.motion : null;
  const duration = motion ? (motion.frames - 1) / motion.rate : 1;
  const times = motion ? Float32Array.from({ length: motion.frames }, (_, i) => i / motion.rate) : null;
  const moving = new Map<string, NonNullable<typeof motion>["channels"][number]>();
  for (const channel of motion?.channels ?? []) moving.set(`${channel.bone}|${channel.channel}`, channel);
  const tracks: THREE.KeyframeTrack[] = [];
  const matrix = new THREE.Matrix4(), t = new THREE.Vector3(), r = new THREE.Quaternion(), s = new THREE.Vector3();
  for (const joint of sample.joints) {
    const series = (channel: "translation" | "rotation" | "scale") => moving.get(`${joint.bone}|${channel}`);
    const translation = series("translation"), rotation = series("rotation"), scale = series("scale");
    // Root carries the placement: its frames are composed with it (a moving Root is sampled channel by channel into one matrix per frame).
    if (joint.bone === "Root" && place) {
      const count = translation || rotation || scale ? motion!.frames : 1;
      const tv: number[] = [], rv: number[] = [], sv: number[] = [];
      for (let i = 0; i < count; i++) {
        const pick = (values: readonly number[] | undefined, width: number, held: readonly number[]) => values ? values.slice(i * width, i * width + width) : held;
        t.fromArray(translationToGltf(pick(translation?.values, 3, joint.translation)));
        r.fromArray(rotationToGltf(pick(rotation?.values, 4, joint.rotation))).normalize();
        s.fromArray(scaleToGltf(pick(scale?.values, 3, joint.scale)));
        matrix.compose(t, r, s).premultiply(place).decompose(t, r, s);
        tv.push(...t.toArray()); rv.push(...r.toArray()); sv.push(...s.toArray());
      }
      const at = count > 1 ? times! : [0];
      tracks.push(new THREE.VectorKeyframeTrack(`${joint.bone}.position`, at, tv), new THREE.QuaternionKeyframeTrack(`${joint.bone}.quaternion`, at, rv),
        new THREE.VectorKeyframeTrack(`${joint.bone}.scale`, at, sv));
      continue;
    }
    const convert = (values: readonly number[], width: number, to: (v: readonly number[]) => number[]) => {
      const out: number[] = [];
      for (let i = 0; i < values.length; i += width) out.push(...to(values.slice(i, i + width)));
      return out;
    };
    tracks.push(
      translation ? new THREE.VectorKeyframeTrack(`${joint.bone}.position`, times!, convert(translation.values, 3, translationToGltf))
        : new THREE.VectorKeyframeTrack(`${joint.bone}.position`, [0], translationToGltf(joint.translation)),
      rotation ? new THREE.QuaternionKeyframeTrack(`${joint.bone}.quaternion`, times!, convert(rotation.values, 4, rotationToGltf))
        : new THREE.QuaternionKeyframeTrack(`${joint.bone}.quaternion`, [0], rotationToGltf(joint.rotation)),
      scale ? new THREE.VectorKeyframeTrack(`${joint.bone}.scale`, times!, convert(scale.values, 3, scaleToGltf))
        : new THREE.VectorKeyframeTrack(`${joint.bone}.scale`, [0], scaleToGltf(joint.scale)));
  }
  const clip = new THREE.AnimationClip(`pose:${sample.id}`, duration, tracks);
  return { clip, moves: !!motion, start: motion ? Math.min(Math.max(sample.time, 0), duration) : 0 };
}
