/**
 * A static face as a vanilla-shaped clip (research/animation/expression-editor-design.md §6.2 "Clips"): the buffer a photo-mode expression's
 * `animAnimationBufferCompressed` holds. Pure; the exporter puts the bytes into an animation set and the platform packs it.
 *
 * Layout, as every vanilla static face has it [resource: `photomode_female_facial.anims`, decoded 28 September 2026]: the set's constant
 * joint keys (three per joint, 16 bytes each, identical in every static face of a gender's set, so copied from its `facial_neutral`), no
 * animated keys, then one constant track key per track in track order (8 bytes: `u16` track, `u16` time, `f32` value). The clip holds
 * deltas (`AdditiveFromRefPose`), so every track but the main poses is 0 and each main pose is its weight. The time field is written as 0,
 * what WolvenKit writes for a constant key at time 0 (vanilla files hold other values there) [hypothesis: the engine ignores it].
 */
import { f32, type ControlVector } from "./vector";

/** A vanilla static face's clip settings. */
export const STATIC_FACE = Object.freeze({ type: "AdditiveFromRefPose", frames: 2, duration: 0.0333333351 });
/** Bytes per constant joint key and per constant track key. */
export const CONST_JOINT_KEY_BYTES = 16;
export const CONST_TRACK_KEY_BYTES = 8;

/** The main-pose control names a rig lacks, sorted (an expression using one can't be exported for that rig). */
export function unknownControls(vector: ControlVector, tracks: readonly string[], main: { start: number; count: number }): string[] {
  const names = new Set(tracks.slice(main.start, main.start + main.count));
  return Object.keys(vector).filter(name => !names.has(name)).sort();
}

/**
 * Every track's value for a static face: the main poses at the vector's weights (float32), everything else 0. Throws a plain error for a
 * control the rig's main poses lack, a weight outside 0–1 or one that isn't finite.
 */
export function staticFaceTracks(vector: ControlVector, tracks: readonly string[], main: { start: number; count: number }): Float32Array {
  const missing = unknownControls(vector, tracks, main);
  if (missing.length) throw Error(`This face rig has no control named ${missing.join(", ")}.`);
  if (!Number.isInteger(main.start) || !Number.isInteger(main.count) || main.start < 0 || main.start + main.count > tracks.length)
    throw Error("The face rig's main-pose block doesn't fit its tracks.");
  const values = new Float32Array(tracks.length);
  for (const [name, weight] of Object.entries(vector)) {
    if (!Number.isFinite(weight) || weight < 0 || weight > 1) throw Error(`The weight of ${name} must be between 0 and 1.`);
    values[tracks.indexOf(name, main.start)] = f32(weight);
  }
  return values;
}

/** The clip's buffer: the joint-key block as given, then one constant key per track. */
export function encodeStaticFace(jointBlock: Uint8Array, tracks: Float32Array): Uint8Array {
  if (jointBlock.byteLength % CONST_JOINT_KEY_BYTES) throw Error("The joint keys aren't whole keys.");
  if (tracks.length > 0xffff) throw Error("Too many tracks for a clip.");
  const out = new Uint8Array(jointBlock.byteLength + tracks.length * CONST_TRACK_KEY_BYTES);
  out.set(jointBlock, 0);
  const view = new DataView(out.buffer);
  let at = jointBlock.byteLength;
  for (let track = 0; track < tracks.length; track++, at += CONST_TRACK_KEY_BYTES) {
    view.setUint16(at, track, true);
    view.setUint16(at + 2, 0, true);
    view.setFloat32(at + 4, tracks[track]!, true);
  }
  return out;
}

/** The counts the set entry's buffer declares for such a clip. */
export function staticFaceCounts(jointBlock: Uint8Array, tracks: number) {
  return { numAnimKeys: 0, numAnimKeysRaw: 0, numConstAnimKeys: jointBlock.byteLength / CONST_JOINT_KEY_BYTES, numTrackKeys: 0,
    numConstTrackKeys: tracks, numTracks: tracks, numFrames: STATIC_FACE.frames, bytes: jointBlock.byteLength + tracks * CONST_TRACK_KEY_BYTES };
}
