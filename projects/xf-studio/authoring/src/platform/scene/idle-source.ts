import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { IDLES_ENDPOINT } from "../../idle-endpoint";
import { IDLE_STATE_SCHEMA, type IdleState, type RestJoint } from "../../idle-body";
import { DEFAULT_IDLE, type IdleCatalogue, type IdleEntry } from "../../idle-catalogue";
import { faceMotionClip, faceMotionScene } from "../../game-blink";
import { poseClip, rotationToGltf, scaleToGltf, translationToGltf } from "../../pose-clip";
import type { FaceClipRecord } from "../api/facial";
import type { PoseSample } from "../../pose-sample";

/**
 * Where the scene's idle comes from (the renderer side of idle-body.ts): the host's idles, read from the player's game files (`game`, both
 * hosts), or a developer preparation's files under `/assets/` (`prepared`, the Python oracle). Either way the idle is a skeleton the body
 * clips play on, the head joints' ancestry, and each idle's body clip and, where one was prepared, its face clip.
 *
 * - **Game**: the skeleton is built from the rig's rest (its A pose, as WolvenKit's export gives its nodes), under an `Armature` node, in
 *   glTF axes (pose-clip.ts conversions); a body clip is the idle's `xfs/pose-sample-1` record with every frame, played as a moving pose; a
 *   face clip is the idle's `xfs/face-motion-1` record, solved on the host by XF Studio's own facial solver, on one shared face skeleton.
 * - **Prepared**: the body GLB's own skeleton and clips, and `cc-idle-binding.json`'s ancestry, as before.
 */
export type IdleSource = {
  readonly catalogue: IdleCatalogue;
  readonly first: IdleEntry;
  /** The skeleton the body clips drive (its bones named as the rig's joints). */
  readonly skeleton: THREE.Object3D;
  readonly ancestry: Readonly<Record<string, string | null>>;
  /** The face skeleton at rest (game source only): the eyes' gaze pivots when no face clip is loaded. */
  readonly faceRest: THREE.Object3D | null;
  body(entry: IdleEntry): Promise<THREE.AnimationClip>;
  /** The entry's face clip and its skeleton, or null when the entry has no face. */
  face(entry: IdleEntry): Promise<{ scene: THREE.Object3D; clip: THREE.AnimationClip } | null>;
  /** Why no idle has a face, in plain words (the host's), when none has. */
  readonly faceReason?: string;
};

/** The idle couldn't be read (plain words; the host's own message when it has one). */
export class IdleSourceError extends Error {}

/** Bones from rest joints (game space, local to their parents), under an `Armature` node, in glTF axes. */
export function restSkeleton(joints: readonly RestJoint[]): THREE.Object3D {
  const root = new THREE.Object3D();
  root.name = "Armature";
  const bones = new Map<string, THREE.Bone>();
  for (const joint of joints) {
    const bone = new THREE.Bone();
    bone.name = joint.bone;
    bone.position.fromArray(translationToGltf(joint.translation));
    bone.quaternion.fromArray(rotationToGltf(joint.rotation));
    bone.scale.fromArray(scaleToGltf(joint.scale));
    bones.set(joint.bone, bone);
  }
  for (const joint of joints) (joint.parent && bones.get(joint.parent) || root).add(bones.get(joint.bone)!);
  root.updateMatrixWorld(true);
  return root;
}

async function json(url: string): Promise<unknown> {
  const response = await fetch(url);
  const value = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok) throw new IdleSourceError(value?.error || "The character creator's idle couldn't be read.");
  return value;
}

/** Read the host's idles; rejects with a plain reason when they can't be played. */
export async function loadIdleSource(): Promise<IdleSource> {
  const state = await json(IDLES_ENDPOINT) as IdleState;
  if (state?.schema !== IDLE_STATE_SCHEMA) throw new IdleSourceError("The character creator's idle couldn't be read.");
  if (state.phase !== "ready") throw new IdleSourceError(state.message);
  const catalogue = state.catalogue, first = catalogue.idles.find(entry => entry.id === DEFAULT_IDLE) ?? catalogue.idles[0];
  if (!first) throw new IdleSourceError("The character creator's idle couldn't be read.");
  const faces = new Map<string, Promise<{ scene: THREE.Object3D; clips: THREE.AnimationClip[] }>>();
  const face = async (entry: IdleEntry) => {
    if (!entry.face) return null;
    let pending = faces.get(entry.face.file);
    if (!pending) {
      pending = new GLTFLoader().loadAsync(`/assets/${entry.face.file}`).then(gltf => ({ scene: gltf.scene, clips: gltf.animations }));
      pending.catch(() => faces.delete(entry.face!.file));
      faces.set(entry.face.file, pending);
    }
    const loaded = await pending, clip = loaded.clips.find(item => item.name === `${entry.face!.clip}_face`);
    if (!clip) throw new IdleSourceError("The prepared face idle is missing its clip.");
    return { scene: loaded.scene, clip };
  };
  if (state.source === "game") {
    const skeleton = restSkeleton(state.rig.joints);
    // Every face clip plays on one face skeleton (the idle keeps the first it is given), built from the first record's rest.
    let faceScene: THREE.Object3D | null = null;
    const records = new Map<string, Promise<THREE.AnimationClip>>();
    const gameFace = async (entry: IdleEntry) => {
      if (!entry.face) return null;
      let pending = records.get(entry.id);
      if (!pending) {
        pending = json(`${IDLES_ENDPOINT}?face=${encodeURIComponent(entry.id)}`).then(value => {
          const record = value as FaceClipRecord;
          faceScene ??= faceMotionScene(record.rest);
          return faceMotionClip(record.clip, `${entry.face!.clip}_face`);
        });
        pending.catch(() => records.delete(entry.id));
        records.set(entry.id, pending);
      }
      const clip = await pending;
      return { scene: faceScene!, clip };
    };
    return { catalogue, first, skeleton, ancestry: state.ancestry, faceRest: state.face ? restSkeleton(state.face.joints) : null, face: gameFace,
      ...(state.faceReason ? { faceReason: state.faceReason } : {}),
      async body(entry) {
        const sample = await json(`${IDLES_ENDPOINT}?body=${encodeURIComponent(entry.id)}`) as PoseSample;
        const clip = poseClip(sample).clip;
        clip.name = entry.clip;
        return clip;
      } };
  }
  // The developer preparation: GLBs and the binding file under /assets/.
  const glbs = new Map<string, Promise<{ scene: THREE.Object3D; clips: THREE.AnimationClip[] }>>();
  const glb = (file: string) => {
    let pending = glbs.get(file);
    if (!pending) {
      pending = new GLTFLoader().loadAsync(`/assets/${file}`).then(gltf => ({ scene: gltf.scene, clips: gltf.animations }));
      pending.catch(() => glbs.delete(file));
      glbs.set(file, pending);
    }
    return pending;
  };
  const [motion, binding] = await Promise.all([glb(first.body), json("/assets/cc-idle-binding.json") as Promise<{ clip: string; ancestry: Record<string, string | null> }>]);
  return { catalogue, first, skeleton: motion.scene, ancestry: binding.ancestry, faceRest: null, face,
    async body(entry) {
      const clip = (await glb(entry.body)).clips.find(item => item.name === entry.clip);
      if (!clip) throw new IdleSourceError("That idle's motion couldn't be read from its prepared file.");
      return clip;
    } };
}
