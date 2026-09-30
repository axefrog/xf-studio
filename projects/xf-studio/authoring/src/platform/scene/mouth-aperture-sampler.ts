import * as THREE from "three";
import { FACE_REST_KEY, lipParting, mouthAperture, mouthLipJoints, type FaceRest, type MouthLipJoints, type Vec3 } from "../../mouth-aperture";

/**
 * The lips' aperture on the drawn head, measured on its posed bones each frame (the renderer side of mouth-aperture.ts): whatever owns the
 * face's bones (the idle's face clip, a held expression, the blink) poses the same bones, so the measure follows all of them.
 *
 * The lip joints come from a face skeleton's rest and its setup's regions, which the host's face motion records carry (`faceMotionScene`
 * keeps them on the scene it builds, `FACE_REST_KEY`); the first record that has them decides, once. Until then (or for a head without such
 * a record: a developer's prepared idle) the answer is null and the interior keeps its fixed parting.
 */
export type FaceRestData = FaceRest & { readonly regions?: readonly number[] };

export type MouthApertureSampler = {
  /** The aperture now (metres, 0 with the lips closed), or null when the lips can't be measured on this head. */
  sample(): number | null;
  /** The joints it measures, once known (developer evidence). */
  readonly lips: MouthLipJoints | null;
};

/**
 * `bones`: the drawn head's own bones (named as the face rig's joints). `rests`: the face motion scenes that may carry a rest and regions
 * (the idle's face, the blink's); asked again until one does.
 */
export function createMouthApertureSampler(bones: () => readonly THREE.Object3D[], rests: () => readonly (THREE.Object3D | null | undefined)[]): MouthApertureSampler {
  let lips: MouthLipJoints | null = null;
  let found: { upper: THREE.Object3D[]; lower: THREE.Object3D[]; frame: THREE.Object3D } | null = null;
  let refused = false;
  const inverse = new THREE.Matrix4(), point = new THREE.Vector3();
  const resolve = () => {
    if (found || refused) return found;
    for (const scene of rests()) {
      const rest = scene?.userData?.[FACE_REST_KEY] as FaceRestData | undefined;
      if (!rest?.regions?.length) continue;
      const chosen = mouthLipJoints(rest, rest.regions);
      if (!chosen) { refused = true; return null; }
      const byName = new Map<string, THREE.Object3D>();
      for (const bone of bones()) if (!byName.has(bone.name)) byName.set(bone.name, bone);
      const take = (names: readonly string[]) => names.map(name => byName.get(name));
      const upper = take(chosen.upper), lower = take(chosen.lower), frame = byName.get(chosen.frame);
      // The head doesn't carry these joints (another head's rig): nothing to measure.
      if (!frame || upper.some(bone => !bone) || lower.some(bone => !bone)) { refused = true; return null; }
      lips = chosen;
      found = { upper: upper as THREE.Object3D[], lower: lower as THREE.Object3D[], frame };
      return found;
    }
    return null;
  };
  const inFrame = (list: readonly THREE.Object3D[]): Vec3[] => list.map(bone => {
    bone.updateWorldMatrix(true, false);
    point.setFromMatrixPosition(bone.matrixWorld).applyMatrix4(inverse);
    return [point.x, point.y, point.z];
  });
  return {
    get lips() { return lips; },
    sample() {
      const joints = resolve();
      if (!joints || !lips) return null;
      joints.frame.updateWorldMatrix(true, false);
      inverse.copy(joints.frame.matrixWorld).invert();
      return mouthAperture(lipParting(inFrame(joints.upper), inFrame(joints.lower), lips.up), lips.rest);
    },
  };
}

/** A drawn head's own bones: its skeleton's, else every bone in the scene graph it was loaded with (the first of each name counts). */
export function headBones(head: THREE.Object3D): THREE.Object3D[] {
  const skinned = head as THREE.SkinnedMesh;
  if (skinned.isSkinnedMesh && skinned.skeleton?.bones.length) return skinned.skeleton.bones;
  let root: THREE.Object3D = head;
  while (root.parent && !(root.parent as THREE.Scene).isScene) root = root.parent;
  const bones: THREE.Object3D[] = [];
  root.traverse(object => { if ((object as THREE.Bone).isBone) bones.push(object); });
  return bones;
}
